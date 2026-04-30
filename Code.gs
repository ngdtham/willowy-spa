// ============================================================
// WILLOWY SPA - Google Apps Script Backend
// ============================================================

const CONFIG = {
  SHEET_ID: '13Ud3Y5IiogcNMpoGw7irKLdgpOH4ANBJrYdF4f0Q7wg',
  SHEETS: {
    CUSTOMERS:   'Customers',
    BOOKINGS:    'Bookings',
    SERVICES:    'Services',
    TECHNICIANS: 'Technicians',
    REFERRALS:   'Referrals',
    SCHEDULES:   'Schedules'
  },
  ADMIN: {
    USERNAME: 'willowy_admin',
    PASSWORD: 'adminadmin'
  },
  SESSION_EXPIRY_MS: 24 * 60 * 60 * 1000, // 24 hours
  SHEETS: {
    CUSTOMERS:   'Customers',
    BOOKINGS:    'Bookings',
    SERVICES:    'Services',
    TECHNICIANS: 'Technicians',
    REFERRALS:   'Referrals',
    SCHEDULES:   'Schedules',
    SESSIONS:    'Sessions',
    ADMINS:      'Admins',
    LOGS:        'Logs'
  }
};

function doGet(e) {
  var html = HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Willowy Spa')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  // Inject URL params as global JS vars (iframe sandbox blocks window.location.search)
  var params = (e && e.parameter) ? e.parameter : {};
  html.append('<script>window.__URL_PARAMS__=' + JSON.stringify(params) + ';</script>');
  return html;
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    const payload = data.payload || {};
    const handlers = {
      'login': handleLogin, 'register': handleRegister, 'updateProfile': handleUpdateProfile,
      'getServices': handleGetServices, 'getTechnicians': handleGetTechnicians,
      'getAvailableSlots': handleGetAvailableSlots, 'createBooking': handleCreateBooking,
      'getCustomerBookings': handleGetCustomerBookings, 'cancelBooking': handleCancelBooking,
      'getReferralInfo': handleGetReferralInfo, 'trackQRScan': handleTrackQRScan,
      'adminLogin': handleAdminLogin,
      'adminGetAllBookings': handleAdminGetAllBookings,
      'adminGetServices': handleAdminGetServices, 'adminSaveService': handleAdminSaveService, 'adminDeleteService': handleAdminDeleteService,
      'adminGetTechnicians': handleAdminGetTechnicians, 'adminSaveTechnician': handleAdminSaveTechnician, 'adminDeleteTechnician': handleAdminDeleteTechnician,
      'adminGetSchedules': handleAdminGetSchedules, 'adminSaveSchedule': handleAdminSaveSchedule, 'adminDeleteSchedule': handleAdminDeleteSchedule,
      'setup': handleSetup
    };
    if (handlers[action]) {
      const result = handlers[action](payload);
      // Resolve user for logging
      let user = 'guest';
      if (payload.token) {
        const userId = validateSession(payload.token);
        if (userId) user = userId;
      } else {
        user = payload.customerId || payload.adminId || 'unknown';
      }
      
      if (result && result.success === false) {
        logAction('ERROR', action, user, result.error);
      }
      return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
    }
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'unknown_action' })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    logAction('CRITICAL', 'doPost', 'system', err.message);
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.message })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ── HELPERS ──────────────────────────────────────────────────
function getSheet(name) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Sheet "' + name + '" không tồn tại.');
  return sheet;
}

function getHeaders(sheet) {
  const lc = sheet.getLastColumn();
  if (lc < 1) return [];
  return sheet.getRange(1, 1, 1, lc).getValues()[0].map(h => String(h).trim());
}

function sheetToObjects(sheet) {
  const lr = sheet.getLastRow(), lc = sheet.getLastColumn();
  if (lr < 2 || lc < 1) return [];
  const headers = sheet.getRange(1, 1, 1, lc).getValues()[0].map(h => String(h).trim());
  const rows = sheet.getRange(2, 1, lr - 1, lc).getValues();
  return rows.map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
    return obj;
  }).filter(obj => Object.values(obj).some(v => v !== '' && v !== null));
}

function appendRow(sheet, headers, obj) {
  sheet.appendRow(headers.map(h => {
    let val = obj[h] !== undefined ? obj[h] : '';
    if (h === 'phone') return "'" + val;
    return val;
  }));
}

function updateRow(sheet, idx, headers, obj) {
  sheet.getRange(idx + 2, 1, 1, headers.length).setValues([headers.map(h => {
    let val = obj[h] !== undefined ? obj[h] : '';
    if (h === 'phone') return "'" + val;
    return val;
  })]);
}

function deleteRow(sheet, idx) { sheet.deleteRow(idx + 2); }

function generateId(prefix) {
  return prefix + '_' + new Date().getTime() + '_' + Math.random().toString(36).substr(2, 5).toUpperCase();
}

function isActive(v) { return v === true || String(v).toUpperCase().trim() === 'TRUE' || String(v).trim() === '1'; }

function normalizeDate(v) {
  if (!v) return '';
  if (v instanceof Date) {
    return v.getFullYear() + '-' + String(v.getMonth()+1).padStart(2,'0') + '-' + String(v.getDate()).padStart(2,'0');
  }
  return String(v).trim().substring(0, 10);
}

function normalizeTime(v) {
  if (!v) return '';
  if (v instanceof Date) return String(v.getHours()).padStart(2,'0') + ':' + String(v.getMinutes()).padStart(2,'0');
  const s = String(v).trim();
  if (s.length === 5) return s;
  const parts = s.split(':');
  return String(parseInt(parts[0]||0)).padStart(2,'0') + ':' + String(parseInt(parts[1]||0)).padStart(2,'0');
}

function timeToMinutes(t) {
  if (!t) return 0;
  const p = String(t).split(':');
  return parseInt(p[0]||0)*60 + parseInt(p[1]||0);
}

function hashPassword(pw) {
  let h = 0; const s = pw + 'WILLOWY_SPA_SALT_2024';
  for (let i = 0; i < s.length; i++) { h = ((h<<5)-h)+s.charCodeAt(i); h=h&h; }
  return Math.abs(h).toString(36).toUpperCase();
}

function sanitizeCustomer(c) { const {passwordHash, isAdmin, ...safe} = c; return safe; }

function verifyAdmin(payload) {
  if (!payload || !payload.token) return false;
  const userId = validateSession(payload.token, 'admin');
  return userId !== false;
}

function verifyCustomer(payload) {
  if (!payload || !payload.token) return false;
  const userId = validateSession(payload.token, 'customer');
  return userId !== false;
}

function createSession(userId, userType) {
  const sessionId = generateId('SES');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CONFIG.SESSION_EXPIRY_MS);
  const sheet = getSheet(CONFIG.SHEETS.SESSIONS);
  appendRow(sheet, getHeaders(sheet), {
    sessionId,
    userId,
    userType,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString()
  });
  return sessionId;
}

function validateSession(token, expectedType) {
  try {
    const sheet = getSheet(CONFIG.SHEETS.SESSIONS);
    const sessions = sheetToObjects(sheet);
    const session = sessions.find(s => s.sessionId === token);
    if (!session) return false;
    
    const now = new Date();
    const expiry = new Date(session.expiresAt);
    if (now > expiry) return false;
    
    if (expectedType && session.userType !== expectedType) return false;
    
    return session.userId;
  } catch (e) {
    return false;
  }
}

function logAction(level, action, user, message) {
  try {
    const sheet = getSheet(CONFIG.SHEETS.LOGS);
    appendRow(sheet, getHeaders(sheet), {
      timestamp: new Date().toISOString(),
      level,
      action,
      user,
      message,
      data: ''
    });
  } catch (e) {
    console.error('Logging failed', e);
  }
}

function handleSetup() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheets = [
    { name: CONFIG.SHEETS.SESSIONS, headers: ['sessionId', 'userId', 'userType', 'issuedAt', 'expiresAt'] },
    { name: CONFIG.SHEETS.ADMINS, headers: ['adminId', 'username', 'passwordHash', 'name', 'isActive'] },
    { name: CONFIG.SHEETS.LOGS, headers: ['timestamp', 'level', 'action', 'user', 'message', 'data'] }
  ];
  
  sheets.forEach(s => {
    let sheet = ss.getSheetByName(s.name);
    if (!sheet) {
      sheet = ss.insertSheet(s.name);
      sheet.appendRow(s.headers);
    }
  });
  
  // Create default admin if Admins sheet is empty
  const adminSheet = ss.getSheetByName(CONFIG.SHEETS.ADMINS);
  if (adminSheet.getLastRow() < 2) {
    appendRow(adminSheet, ['adminId', 'username', 'passwordHash', 'name', 'isActive'], {
      adminId: 'ADMIN_001',
      username: CONFIG.ADMIN.USERNAME,
      passwordHash: hashPassword(CONFIG.ADMIN.PASSWORD),
      name: 'Super Admin',
      isActive: true
    });
  }
  
  return { success: true, message: 'Setup complete. Default admin created if needed.' };
}

// ── AUTH ─────────────────────────────────────────────────────
function handleLogin(payload) {
  const { phone, password } = payload;
  if (!phone || !password) return { success: false, error: 'missing_fields' };
  const customers = sheetToObjects(getSheet(CONFIG.SHEETS.CUSTOMERS));
  const customer = customers.find(c => String(c.phone).trim() === String(phone).trim() && isActive(c.isActive));
  if (!customer) return { success: false, error: 'not_found' };
  if (customer.passwordHash !== hashPassword(password)) return { success: false, error: 'wrong_password' };
  
  const token = createSession(customer.customerId, 'customer');
  logAction('INFO', 'login', customer.customerId, 'Customer logged in');
  
  return { success: true, customer: sanitizeCustomer(customer), token };
}

function handleAdminLogin(payload) {
  const { username, password } = payload;
  if (!username || !password) return { success: false, error: 'missing_fields' };
  
  const adminSheet = getSheet(CONFIG.SHEETS.ADMINS);
  const admins = sheetToObjects(adminSheet);
  const admin = admins.find(a => a.username === username && isActive(a.isActive));
  
  if (!admin) return { success: false, error: 'not_found' };
  if (admin.passwordHash !== hashPassword(password)) return { success: false, error: 'wrong_password' };
  
  const token = createSession(admin.adminId, 'admin');
  logAction('INFO', 'adminLogin', admin.adminId, 'Admin logged in');
  
  return { success: true, admin: { adminId: admin.adminId, name: admin.name }, token };
}

function handleRegister(payload) {
  try {
    const { phone, email, name, password, referralCode } = payload;
    if (!phone || !name || !password) return { success: false, error: 'missing_fields' };
    const sheet = getSheet(CONFIG.SHEETS.CUSTOMERS);
    const customers = sheetToObjects(sheet);
    const headers = getHeaders(sheet);
    if (customers.find(c => String(c.phone).trim() === String(phone).trim())) return { success: false, error: 'phone_exists' };
    const customerId = generateId('CUST');
    const myReferralCode = 'REF_' + customerId.split('_')[1];
    const now = new Date().toISOString();
    let referredBy = '';
    if (referralCode) {
      const referrer = customers.find(c => c.referralCode === referralCode);
      if (referrer) {
        referredBy = referrer.customerId;
        try {
          const refSheet = getSheet(CONFIG.SHEETS.REFERRALS);
          appendRow(refSheet, getHeaders(refSheet), { referralId: generateId('REF'), referrerId: referrer.customerId, referredId: customerId, qrCode: referralCode, scannedAt: now, registeredAt: now, status: 'registered' });
        } catch(e) {}
      }
    }
    appendRow(sheet, headers, { customerId, phone: String(phone).trim(), email: email||'', name, passwordHash: hashPassword(password), referralCode: myReferralCode, referredBy, referralCount: 0, totalVisits: 0, createdAt: now, isActive: true, isAdmin: false });
    return { success: true, customer: sanitizeCustomer({ customerId, phone, email: email||'', name, referralCode: myReferralCode, referredBy, referralCount: 0, totalVisits: 0, createdAt: now, isActive: true, isAdmin: false }), isFirstVisit: !!referredBy };
  } catch(e) { return { success: false, error: 'register_failed: ' + e.message }; }
}

function handleUpdateProfile(payload) {
  try {
    const { customerId, name, email } = payload;
    const sheet = getSheet(CONFIG.SHEETS.CUSTOMERS);
    const customers = sheetToObjects(sheet);
    const headers = getHeaders(sheet);
    const idx = customers.findIndex(c => c.customerId === customerId);
    if (idx === -1) return { success: false, error: 'not_found' };
    if (name) customers[idx].name = name;
    if (email !== undefined) customers[idx].email = email;
    updateRow(sheet, idx, headers, customers[idx]);
    return { success: true, customer: sanitizeCustomer(customers[idx]) };
  } catch(e) { return { success: false, error: e.message }; }
}

// ── SERVICES ─────────────────────────────────────────────────
function handleGetServices() {
  try {
    return { success: true, services: sheetToObjects(getSheet(CONFIG.SHEETS.SERVICES)).filter(s => isActive(s.isActive)) };
  } catch(e) { return { success: false, error: e.message }; }
}

// ── TECHNICIANS ───────────────────────────────────────────────
function handleGetTechnicians(payload) {
  try {
    const { serviceId } = payload||{};
    let techs = sheetToObjects(getSheet(CONFIG.SHEETS.TECHNICIANS)).filter(t => isActive(t.isActive));
    if (serviceId) techs = techs.filter(t => t.specialties && String(t.specialties).split(',').map(s=>s.trim()).includes(serviceId));
    return { success: true, technicians: techs };
  } catch(e) { return { success: false, error: e.message }; }
}

// ── BOOKING ───────────────────────────────────────────────────
function handleGetAvailableSlots(payload) {
  const { technicianId, date, serviceId } = payload;
  if (!technicianId || !date) return { success: false, error: 'missing_fields' };
  let duration = 60;
  try { const svc = sheetToObjects(getSheet(CONFIG.SHEETS.SERVICES)).find(s => s.serviceId === serviceId); if (svc) duration = parseInt(svc.duration)||60; } catch(e) {}
  let existingBookings = [];
  try {
    existingBookings = sheetToObjects(getSheet(CONFIG.SHEETS.BOOKINGS)).filter(b =>
      String(b.technicianId).trim() === technicianId && normalizeDate(b.bookingDate) === date && (b.status==='confirmed'||b.status==='pending')
    );
  } catch(e) {}
  let techSchedule = null;
  try {
    const schedules = sheetToObjects(getSheet(CONFIG.SHEETS.SCHEDULES));
    techSchedule = schedules.find(s => String(s.technicianId).trim() === technicianId && normalizeDate(s.date) === date && isActive(s.isActive));
  } catch(e) {}
  // Use default working hours if no specific schedule exists
  if (!techSchedule) return { success: false, error: 'no_schedule' };
  var scheduleStart = normalizeTime(techSchedule.startTime);
  var scheduleEnd = normalizeTime(techSchedule.endTime);
  return { success: true, slots: generateTimeSlots(scheduleStart, scheduleEnd, duration, existingBookings, date) };
}

function generateTimeSlots(startTime, endTime, duration, bookings, date) {
  if (!startTime || !endTime) return [];
  const now = new Date();
  const sm = timeToMinutes(startTime), em = timeToMinutes(endTime);
  const slots = [];
  for (let m = sm; m + duration <= em; m += 30) {
    const s = String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
    const e2 = String(Math.floor((m+duration)/60)).padStart(2,'0')+':'+String((m+duration)%60).padStart(2,'0');
    const isPast = new Date(date+'T'+s+':00') <= now;
    const isBooked = bookings.some(b => { const bs=timeToMinutes(normalizeTime(b.startTime)), be=timeToMinutes(normalizeTime(b.endTime)); return !(m+duration<=bs||m>=be); });
    slots.push({ start: s, end: e2, available: !isPast && !isBooked, isPast: isPast, isBooked: isBooked });
  }
  return slots;
}

function handleCreateBooking(payload) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); // Đợi tối đa 20 giây
    const { customerId, serviceId, technicianId, note, isRecurring, bookingDate, startTime, startDate, endDate, daysOfWeek } = payload;
    if (!customerId||!serviceId||!technicianId) return { success: false, error: 'missing_fields' };
    
    let datesToBook = [];
    let stTime = startTime;
    if (isRecurring) {
      if (!startDate || !endDate || !daysOfWeek || !daysOfWeek.length || !startTime) return { success: false, error: 'missing_fields' };
      stTime = startTime;
      
      // Khởi tạo ngày local để tránh lệch múi giờ
      const [sy, smm, sd] = startDate.split('-').map(Number);
      const [ey, emm, ed] = endDate.split('-').map(Number);
      let curr = new Date(sy, smm - 1, sd);
      let end = new Date(ey, emm - 1, ed);
      
      let maxDays = 180;
      while (curr <= end && maxDays > 0) {
        if (daysOfWeek.includes(curr.getDay())) {
          // Format lại thành YYYY-MM-DD local
          const dStr = curr.getFullYear() + '-' + String(curr.getMonth()+1).padStart(2,'0') + '-' + String(curr.getDate()).padStart(2,'0');
          datesToBook.push(dStr);
        }
        curr.setDate(curr.getDate() + 1);
        maxDays--;
      }
    } else {
      if (!bookingDate || !startTime) return { success: false, error: 'missing_fields' };
      datesToBook.push(bookingDate);
    }
    
    if (datesToBook.length === 0) return { success: false, error: 'no_valid_dates' };

    const services = sheetToObjects(getSheet(CONFIG.SHEETS.SERVICES));
    const svc = services.find(s => s.serviceId === serviceId);
    if (!svc) return { success: false, error: 'service_not_found' };
    const duration = parseInt(svc.duration)||60;
    const em2 = timeToMinutes(stTime) + duration;
    const endTime = String(Math.floor(em2/60)).padStart(2,'0')+':'+String(em2%60).padStart(2,'0');
    
    const bSheet = getSheet(CONFIG.SHEETS.BOOKINGS);
    const existingBookings = sheetToObjects(bSheet).filter(b => b.status === 'confirmed' || b.status === 'pending');
    const sMin=timeToMinutes(stTime), eMin=timeToMinutes(endTime);
    
    let successfulBookings = [];
    let skippedDates = [];
    const now = new Date();
    const schSheet = getSheet(CONFIG.SHEETS.SCHEDULES);
    const existingSchedules = sheetToObjects(schSheet);
    
    for (let d of datesToBook) {
      // So sánh giờ: sử dụng Date(y, m-1, d, hour, min) để đảm bảo local time
      const [y, mm, dd] = d.split('-').map(Number);
      const [hh, min] = stTime.split(':').map(Number);
      const bookingStartDateTime = new Date(y, mm - 1, dd, hh, min);
      
      if (bookingStartDateTime <= now) { skippedDates.push(d); continue; }
      
      const existingForDay = existingBookings.filter(b => String(b.technicianId).trim()===technicianId && normalizeDate(b.bookingDate)===d);
      if (existingForDay.some(b=>{ 
        const bs=timeToMinutes(normalizeTime(b.startTime)),be=timeToMinutes(normalizeTime(b.endTime));
        const isConflict = !(eMin<=bs||sMin>=be);
        if (isConflict) {
          // Nếu trùng lịch nhưng lại là CÙNG 1 khách hàng, cùng dịch vụ, cùng giờ => Coi như đã đặt thành công (trường hợp retry)
          if (b.customerId === customerId && b.serviceId === serviceId && normalizeTime(b.startTime) === stTime) {
            return false; // Không coi là conflict
          }
          return true;
        }
        return false;
      })) {
        skippedDates.push(d); continue;
      }
      
      const bookingId = generateId('BKG');
      const booking = { bookingId, customerId, serviceId, technicianId, bookingDate: d, startTime: stTime, endTime, status:'confirmed', note: note||'', createdAt: new Date().toISOString() };
      successfulBookings.push(booking);
      existingBookings.push(booking);
      
      // Kiểm tra schedule trong memory
      const existingSch = existingSchedules.find(s => String(s.technicianId).trim() === technicianId && normalizeDate(s.date) === d && isActive(s.isActive));
      if (!existingSch) {
        skippedDates.push(d); continue;
      }
    }
    
    if (successfulBookings.length === 0) return { success: false, error: 'slot_taken' };

    // Batch write Bookings
    const bHeaders = getHeaders(bSheet);
    const bValues = successfulBookings.map(b => bHeaders.map(h => {
      let val = b[h] !== undefined ? b[h] : '';
      if (h === 'phone') return "'" + val;
      return val;
    }));
    bSheet.getRange(bSheet.getLastRow() + 1, 1, bValues.length, bHeaders.length).setValues(bValues);

    // Batch write Schedules - Removed as per strict policy
    
    
    if (successfulBookings.length === 0) return { success: false, error: 'slot_taken' };

    // Cập nhật referral và totalVisits
    try {
      const cBookings = existingBookings.filter(b => b.customerId === customerId && b.status === 'confirmed');
      if (cBookings.length === successfulBookings.length) { // Nếu đây là những booking đầu tiên
        const cSheet = getSheet(CONFIG.SHEETS.CUSTOMERS);
        const customers = sheetToObjects(cSheet);
        const customer = customers.find(c => c.customerId === customerId);
        if (customer && customer.referredBy) {
          const rIdx = customers.findIndex(c => c.customerId === customer.referredBy);
          if (rIdx !== -1) {
            const headers = getHeaders(cSheet);
            customers[rIdx].referralCount = (parseInt(customers[rIdx].referralCount) || 0) + 1;
            updateRow(cSheet, rIdx, headers, customers[rIdx]);
          }
        }
      }
      const cs=getSheet(CONFIG.SHEETS.CUSTOMERS); const ca=sheetToObjects(cs); const ch=getHeaders(cs); const ci=ca.findIndex(c=>c.customerId===customerId); 
      if(ci!==-1){ca[ci].totalVisits=(parseInt(ca[ci].totalVisits)||0)+successfulBookings.length;updateRow(cs,ci,ch,ca[ci]);}
    } catch(e) {}
    
    return { success: true, bookings: successfulBookings, skippedDates };
  } catch(e) { return { success: false, error: 'create_booking_failed: ' + e.message }; }
  finally { lock.releaseLock(); }
}

function handleGetCustomerBookings(payload) {
  const { customerId } = payload;
  if (!customerId) return { success: false, error: 'missing_fields' };
  try {
    const bookings = sheetToObjects(getSheet(CONFIG.SHEETS.BOOKINGS)).filter(b => b.customerId===customerId);
    const services = sheetToObjects(getSheet(CONFIG.SHEETS.SERVICES));
    const techs = sheetToObjects(getSheet(CONFIG.SHEETS.TECHNICIANS));
    const enriched = bookings.map(b => ({ ...b, bookingDate: normalizeDate(b.bookingDate), startTime: normalizeTime(b.startTime), endTime: normalizeTime(b.endTime), service: services.find(s=>s.serviceId===b.serviceId)||{}, technician: techs.find(t=>t.technicianId===b.technicianId)||{} }));
    // Sắp xếp theo ngày đặt lịch: ngày gần nhất lên trên
    enriched.sort((a,b) => {
      const ad = a.bookingDate + 'T' + a.startTime;
      const bd = b.bookingDate + 'T' + b.startTime;
      return ad.localeCompare(bd); // Sắp xếp tăng dần theo thời gian diễn ra
    });
    return { success: true, bookings: enriched };
  } catch(e) { return { success: false, error: e.message }; }
}

function handleCancelBooking(payload) {
  const { bookingId, customerId } = payload;
  const sheet = getSheet(CONFIG.SHEETS.BOOKINGS);
  const bookings = sheetToObjects(sheet); const headers = getHeaders(sheet);
  const idx = bookings.findIndex(b => b.bookingId===bookingId && b.customerId===customerId);
  if (idx===-1) return { success: false, error: 'not_found' };
  if (bookings[idx].status==='cancelled') return { success: false, error: 'already_cancelled' };
  bookings[idx].status = 'cancelled'; updateRow(sheet, idx, headers, bookings[idx]);
  return { success: true };
}

// ── REFERRAL ──────────────────────────────────────────────────
function handleGetReferralInfo(payload) {
  const { customerId } = payload;
  const customers = sheetToObjects(getSheet(CONFIG.SHEETS.CUSTOMERS));
  const c = customers.find(c => c.customerId===customerId);
  if (!c) return { success: false, error: 'not_found' };
  return { success: true, referralCode: c.referralCode, referralCount: parseInt(c.referralCount)||0 };
}

function handleTrackQRScan(payload) {
  const { referralCode } = payload;
  const customers = sheetToObjects(getSheet(CONFIG.SHEETS.CUSTOMERS));
  const referrer = customers.find(c => c.referralCode===referralCode);
  if (!referrer) return { success: false, error: 'invalid_code' };
  try { const rs=getSheet(CONFIG.SHEETS.REFERRALS); appendRow(rs,getHeaders(rs),{referralId:generateId('SCAN'),referrerId:referrer.customerId,referredId:'',qrCode:referralCode,scannedAt:new Date().toISOString(),registeredAt:'',status:'scanned'}); } catch(e) {}
  return { success: true, referrerName: referrer.name };
}

// ── ADMIN ─────────────────────────────────────────────────────
function handleAdminLogin(payload) {
  // Deprecated - Admin now uses regular login
  return { success: false, error: 'deprecated' };
}

function handleAdminGetAllBookings(payload) {
  if (!verifyAdmin(payload)) return { success: false, error: 'unauthorized' };
  try {
    const bookings = sheetToObjects(getSheet(CONFIG.SHEETS.BOOKINGS));
    const services = sheetToObjects(getSheet(CONFIG.SHEETS.SERVICES));
    const techs = sheetToObjects(getSheet(CONFIG.SHEETS.TECHNICIANS));
    const customers = sheetToObjects(getSheet(CONFIG.SHEETS.CUSTOMERS));
    const enriched = bookings.map(b => ({ ...b, bookingDate: normalizeDate(b.bookingDate), startTime: normalizeTime(b.startTime), endTime: normalizeTime(b.endTime), service: services.find(s=>s.serviceId===b.serviceId)||{}, technician: techs.find(t=>t.technicianId===b.technicianId)||{}, customer: sanitizeCustomer(customers.find(c=>c.customerId===b.customerId)||{}) }));
    enriched.sort((a,b) => (b.bookingDate+b.startTime).localeCompare(a.bookingDate+a.startTime));
    return { success: true, bookings: enriched };
  } catch(e) { return { success: false, error: e.message }; }
}

function handleAdminGetServices(payload) {
  if (!verifyAdmin(payload)) return { success: false, error: 'unauthorized' };
  try { return { success: true, services: sheetToObjects(getSheet(CONFIG.SHEETS.SERVICES)) }; } catch(e) { return { success: false, error: e.message }; }
}

function handleAdminSaveService(payload) {
  if (!verifyAdmin(payload)) return { success: false, error: 'unauthorized' };
  try {
    const { service } = payload;
    const sheet = getSheet(CONFIG.SHEETS.SERVICES); const all = sheetToObjects(sheet); const headers = getHeaders(sheet);
    const idx = all.findIndex(s => s.serviceId===service.serviceId);
    if (idx===-1) { if (!service.serviceId) service.serviceId=generateId('SVC'); appendRow(sheet, headers, service); }
    else updateRow(sheet, idx, headers, service);
    return { success: true };
  } catch(e) { return { success: false, error: e.message }; }
}

function handleAdminDeleteService(payload) {
  if (!verifyAdmin(payload)) return { success: false, error: 'unauthorized' };
  try {
    const sheet = getSheet(CONFIG.SHEETS.SERVICES); const all = sheetToObjects(sheet); const headers = getHeaders(sheet);
    const idx = all.findIndex(s => s.serviceId===payload.serviceId);
    if (idx===-1) return { success: false, error: 'not_found' };
    all[idx].isActive = false; updateRow(sheet, idx, headers, all[idx]); return { success: true };
  } catch(e) { return { success: false, error: e.message }; }
}

function handleAdminGetTechnicians(payload) {
  if (!verifyAdmin(payload)) return { success: false, error: 'unauthorized' };
  try { return { success: true, technicians: sheetToObjects(getSheet(CONFIG.SHEETS.TECHNICIANS)) }; } catch(e) { return { success: false, error: e.message }; }
}

function handleAdminSaveTechnician(payload) {
  if (!verifyAdmin(payload)) return { success: false, error: 'unauthorized' };
  try {
    const { technician } = payload;
    const sheet = getSheet(CONFIG.SHEETS.TECHNICIANS); const all = sheetToObjects(sheet); const headers = getHeaders(sheet);
    const idx = all.findIndex(t => t.technicianId===technician.technicianId);
    if (idx===-1) { if (!technician.technicianId) technician.technicianId=generateId('TECH'); appendRow(sheet, headers, technician); }
    else updateRow(sheet, idx, headers, technician);
    return { success: true };
  } catch(e) { return { success: false, error: e.message }; }
}

function handleAdminDeleteTechnician(payload) {
  if (!verifyAdmin(payload)) return { success: false, error: 'unauthorized' };
  try {
    const sheet = getSheet(CONFIG.SHEETS.TECHNICIANS); const all = sheetToObjects(sheet); const headers = getHeaders(sheet);
    const idx = all.findIndex(t => t.technicianId===payload.technicianId);
    if (idx===-1) return { success: false, error: 'not_found' };
    all[idx].isActive = false; updateRow(sheet, idx, headers, all[idx]); return { success: true };
  } catch(e) { return { success: false, error: e.message }; }
}

function handleAdminGetSchedules(payload) {
  if (!verifyAdmin(payload)) return { success: false, error: 'unauthorized' };
  try {
    const schedules = sheetToObjects(getSheet(CONFIG.SHEETS.SCHEDULES)).map(s => ({ ...s, date: normalizeDate(s.date), startTime: normalizeTime(s.startTime), endTime: normalizeTime(s.endTime) }));
    return { success: true, schedules };
  } catch(e) { return { success: false, error: e.message }; }
}

function handleAdminSaveSchedule(payload) {
  if (!verifyAdmin(payload)) return { success: false, error: 'unauthorized' };
  try {
    const { schedule } = payload;
    const sheet = getSheet(CONFIG.SHEETS.SCHEDULES); const all = sheetToObjects(sheet); const headers = getHeaders(sheet);
    const idx = all.findIndex(s => s.scheduleId===schedule.scheduleId);
    if (idx===-1) { if (!schedule.scheduleId) schedule.scheduleId=generateId('SCH'); appendRow(sheet, headers, schedule); }
    else updateRow(sheet, idx, headers, schedule);
    return { success: true };
  } catch(e) { return { success: false, error: e.message }; }
}

function handleAdminDeleteSchedule(payload) {
  if (!verifyAdmin(payload)) return { success: false, error: 'unauthorized' };
  try {
    const sheet = getSheet(CONFIG.SHEETS.SCHEDULES); const all = sheetToObjects(sheet); const headers = getHeaders(sheet);
    const idx = all.findIndex(s => s.scheduleId===payload.scheduleId);
    if (idx===-1) return { success: false, error: 'not_found' };
    all[idx].isActive = false; updateRow(sheet, idx, headers, all[idx]); return { success: true };
  } catch(e) { return { success: false, error: e.message }; }
}

