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
  TELEGRAM: {
    TOKEN: '8624713800:AAGz_nWjpTKWLqc2-QZ55OU6BQht2K43woM', // Mã Token Bot chuẩn
    CHAT_ID: '-1003899972621' // ID Nhóm Willowy Team
  },
  SESSION_EXPIRY_MS: 24 * 60 * 60 * 1000 // 24h
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

    // Telegram webhook update (has update_id field)
    if (data.update_id !== undefined) {
      handleTelegramUpdate(data);
      return ContentService.createTextOutput('OK');
    }

    const action = data.action;
    const payload = data.payload || {};
    const handlers = {
      'login': handleLogin, 'register': handleRegister, 'updateProfile': handleUpdateProfile,
      'forgotPassword': handleForgotPassword, 'verifyResetCode': handleVerifyResetCode, 'changePassword': handleChangePassword,
      'getServices': handleGetServices, 'getTechnicians': handleGetTechnicians,
      'getAvailableSlots': handleGetAvailableSlots, 'createBooking': handleCreateBooking,
      'getCustomerBookings': handleGetCustomerBookings, 'cancelBooking': handleCancelBooking,
      'getReferralInfo': handleGetReferralInfo, 'trackQRScan': handleTrackQRScan,
      'adminLogin': handleAdminLogin,
      'adminGetAllBookings': handleAdminGetAllBookings,
      'adminGetServices': handleAdminGetServices, 'adminSaveService': handleAdminSaveService, 'adminDeleteService': handleAdminDeleteService,
      'adminGetTechnicians': handleAdminGetTechnicians, 'adminSaveTechnician': handleAdminSaveTechnician, 'adminDeleteTechnician': handleAdminDeleteTechnician,
      'adminGetSchedules': handleAdminGetSchedules, 'adminSaveSchedule': handleAdminSaveSchedule, 'adminDeleteSchedule': handleAdminDeleteSchedule,
      'setup': runSetupTool
    };
    if (handlers[action]) {
      return ContentService.createTextOutput(JSON.stringify(handlers[action](payload))).setMimeType(ContentService.MimeType.JSON);
    }
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'unknown_action' })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
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

function countCustomerVisits(bookings, customerId) {
  return bookings.filter(b => b.customerId === customerId && (b.status === 'confirmed' || b.status === 'completed')).length;
}

function refreshCustomerTotalVisits(customerId) {
  if (!customerId) return 0;
  const cSheet = getSheet(CONFIG.SHEETS.CUSTOMERS);
  const customers = sheetToObjects(cSheet);
  const headers = getHeaders(cSheet);
  const idx = customers.findIndex(c => c.customerId === customerId);
  if (idx === -1) return 0;
  const bookings = sheetToObjects(getSheet(CONFIG.SHEETS.BOOKINGS));
  const actualVisits = countCustomerVisits(bookings, customerId);
  if ((parseInt(customers[idx].totalVisits) || 0) !== actualVisits) {
    customers[idx].totalVisits = actualVisits;
    updateRow(cSheet, idx, headers, customers[idx]);
  }
  return actualVisits;
}

function hashPassword(pw) {
  let h = 0; const s = pw + 'WILLOWY_SPA_SALT_2024';
  for (let i = 0; i < s.length; i++) { h = ((h<<5)-h)+s.charCodeAt(i); h=h&h; }
  return Math.abs(h).toString(36).toUpperCase();
}

function sanitizeCustomer(c) { const {passwordHash, ...safe} = c; return safe; }

function verifyAdmin(payload) {
  if (!payload || !payload.adminToken) return false;
  const parts = payload.adminToken.split(':');
  if (parts.length !== 2) return false;
  return parts[0] === CONFIG.ADMIN.USERNAME && parts[1] === hashPassword(CONFIG.ADMIN.PASSWORD);
}

// ── AUTH ─────────────────────────────────────────────────────
function handleLogin(payload) {
  const { phone, password } = payload;
  if (!phone || !password) return { success: false, error: 'missing_fields' };
  const customers = sheetToObjects(getSheet(CONFIG.SHEETS.CUSTOMERS));
  const customer = customers.find(c => String(c.phone).trim() === String(phone).trim() && isActive(c.isActive));
  if (!customer) return { success: false, error: 'not_found' };
  if (customer.passwordHash !== hashPassword(password)) return { success: false, error: 'wrong_password' };
  const token = CONFIG.ADMIN.USERNAME + ':' + hashPassword(CONFIG.ADMIN.PASSWORD); // Simplistic admin token
  return { success: true, customer: sanitizeCustomer(customer), isAdmin: isActive(customer.isAdmin), token: (isActive(customer.isAdmin) ? token : null) };
}

function handleRegister(payload) {
  try {
    const { phone, email, name, password, referralCode } = payload;
    if (!phone || !name || !password) return { success: false, error: 'missing_fields' };
    if (!email) return { success: false, error: 'email_required_for_recovery' };
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

// ── PASSWORD RECOVERY ────────────────────────────────────────
function handleForgotPassword(payload) {
  const { email } = payload;
  if (!email) return { success: false, error: 'missing_email' };
  
  const customers = sheetToObjects(getSheet(CONFIG.SHEETS.CUSTOMERS));
  const customer = customers.find(c => String(c.email).trim() === String(email).trim() && isActive(c.isActive));
  
  if (!customer) return { success: false, error: 'email_not_found' };
  
  const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits
  CacheService.getScriptCache().put('RESET_CODE_' + email, code, 900); // 15 minutes
  
  try {
    MailApp.sendEmail(email, "Mã khôi phục mật khẩu - Willowy Spa", "Mã xác nhận khôi phục mật khẩu của bạn là: " + code + "\n\nMã này sẽ hết hạn trong 15 phút.");
  } catch(e) {
    return { success: false, error: 'failed_to_send_email: ' + e.message };
  }
  
  return { success: true };
}

function handleVerifyResetCode(payload) {
  const { email, code } = payload;
  if (!email || !code) return { success: false, error: 'missing_fields' };
  
  const cachedCode = CacheService.getScriptCache().get('RESET_CODE_' + email);
  if (!cachedCode || cachedCode !== code) {
    return { success: false, error: 'invalid_or_expired_code' };
  }
  
  const customers = sheetToObjects(getSheet(CONFIG.SHEETS.CUSTOMERS));
  const customer = customers.find(c => String(c.email).trim() === String(email).trim() && isActive(c.isActive));
  
  if (!customer) return { success: false, error: 'customer_not_found' };
  
  const resetToken = generateId('TOKEN');
  CacheService.getScriptCache().put('RESET_TOKEN_' + customer.customerId, resetToken, 900);
  CacheService.getScriptCache().remove('RESET_CODE_' + email);
  
  const adminToken = CONFIG.ADMIN.USERNAME + ':' + hashPassword(CONFIG.ADMIN.PASSWORD);
  
  return { 
    success: true, 
    resetToken, 
    customer: sanitizeCustomer(customer), 
    isAdmin: isActive(customer.isAdmin), 
    token: (isActive(customer.isAdmin) ? adminToken : null) 
  };
}

function handleChangePassword(payload) {
  const { customerId, newPassword, oldPassword, resetToken } = payload;
  if (!customerId || !newPassword) return { success: false, error: 'missing_fields' };
  
  const sheet = getSheet(CONFIG.SHEETS.CUSTOMERS);
  const customers = sheetToObjects(sheet);
  const headers = getHeaders(sheet);
  const idx = customers.findIndex(c => c.customerId === customerId);
  if (idx === -1) return { success: false, error: 'not_found' };
  
  const customer = customers[idx];
  
  if (resetToken) {
    const cachedToken = CacheService.getScriptCache().get('RESET_TOKEN_' + customerId);
    if (!cachedToken || cachedToken !== resetToken) {
      return { success: false, error: 'invalid_or_expired_token' };
    }
  } else if (oldPassword) {
    if (customer.passwordHash !== hashPassword(oldPassword)) {
      return { success: false, error: 'wrong_old_password' };
    }
  } else {
    return { success: false, error: 'unauthorized_change' };
  }
  
  customer.passwordHash = hashPassword(newPassword);
  updateRow(sheet, idx, headers, customer);
  
  if (resetToken) {
    CacheService.getScriptCache().remove('RESET_TOKEN_' + customerId);
  }
  
  return { success: true };
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
    
    // Thêm tùy chọn "Spa sắp xếp" lên đầu danh sách
    techs.unshift({ 
      technicianId: 'SPA_ASSIGN', 
      nameVi: 'Spa sắp xếp', 
      nameEn: 'Spa arranges', 
      isActive: true, 
      specialties: serviceId || '' 
    });
    
    return { success: true, technicians: techs };
  } catch(e) { return { success: false, error: e.message }; }
}

// ── BOOKING ───────────────────────────────────────────────────
function handleGetAvailableSlots(payload) {
  const { technicianId, date, serviceId } = payload;
  if (!technicianId || !date) return { success: false, error: 'missing_fields' };
  
  let duration = 60;
  try { 
    const svc = sheetToObjects(getSheet(CONFIG.SHEETS.SERVICES)).find(s => s.serviceId === serviceId); 
    if (svc) duration = parseInt(svc.duration)||60; 
  } catch(e) {}

  if (technicianId === 'SPA_ASSIGN') {
    // Logic cho "Spa sắp xếp": slot trống nếu có ít nhất 1 KTV có thể làm dịch vụ này đang rảnh
    const allTechs = sheetToObjects(getSheet(CONFIG.SHEETS.TECHNICIANS)).filter(t => isActive(t.isActive));
    const eligibleTechs = serviceId ? allTechs.filter(t => t.specialties && String(t.specialties).split(',').map(s=>s.trim()).includes(serviceId)) : allTechs;
    
    if (eligibleTechs.length === 0) return { success: true, slots: [] };

    const bSheet = getSheet(CONFIG.SHEETS.BOOKINGS);
    const allBookings = sheetToObjects(bSheet).filter(b => normalizeDate(b.bookingDate) === date && (b.status==='confirmed'||b.status==='pending'));
    
    const schSheet = getSheet(CONFIG.SHEETS.SCHEDULES);
    const allSchedules = sheetToObjects(schSheet).filter(s => normalizeDate(s.date) === date && isActive(s.isActive));

    // Giả định giờ làm việc chung từ 08:00 đến 23:00 nếu không có lịch cụ thể
    const slots = generateMultiTechTimeSlots('08:00', '23:00', duration, eligibleTechs, allBookings, allSchedules, date);
    return { success: true, slots };
  }

  // Logic cũ cho 1 KTV cụ thể
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
  
  var scheduleStart = techSchedule ? normalizeTime(techSchedule.startTime) : '08:00';
  var scheduleEnd = techSchedule ? normalizeTime(techSchedule.endTime) : '23:00';
  return { success: true, slots: generateTimeSlots(scheduleStart, scheduleEnd, duration, existingBookings, date) };
}

function generateMultiTechTimeSlots(startTime, endTime, duration, techs, bookings, schedules, date) {
  const now = new Date();
  const sm = timeToMinutes(startTime), em = timeToMinutes(endTime);
  const slots = [];
  
  for (let m = sm; m + duration <= em; m += 30) {
    const s = String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
    const e2 = String(Math.floor((m+duration)/60)).padStart(2,'0')+':'+String((m+duration)%60).padStart(2,'0');
    const isPast = new Date(date+'T'+s+':00') <= now;
    
    // Tìm xem có KTV nào rảnh trong khung giờ này không
    let availableTechCount = 0;
    for (let tech of techs) {
      const sch = schedules.find(sc => String(sc.technicianId).trim() === tech.technicianId);
      const sStart = sch ? timeToMinutes(normalizeTime(sch.startTime)) : timeToMinutes('08:00');
      const sEnd = sch ? timeToMinutes(normalizeTime(sch.endTime)) : timeToMinutes('23:00');
      
      // Nếu KTV không làm việc lúc này
      if (m < sStart || (m + duration) > sEnd) continue;
      
      // Kiểm tra lịch bận
      const isBusy = bookings.filter(b => String(b.technicianId).trim() === tech.technicianId).some(b => {
        const bs = timeToMinutes(normalizeTime(b.startTime)), be = timeToMinutes(normalizeTime(b.endTime));
        return !(m + duration <= bs || m >= be);
      });
      
      if (!isBusy) { availableTechCount++; break; } // Chỉ cần 1 người rảnh
    }
    
    slots.push({ start: s, end: e2, available: !isPast && availableTechCount > 0, isPast: isPast, isBooked: availableTechCount === 0 });
  }
  return slots;
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
      
      const [sy, smm, sd] = startDate.split('-').map(Number);
      const [ey, emm, ed] = endDate.split('-').map(Number);
      let curr = new Date(sy, smm - 1, sd);
      let end = new Date(ey, emm - 1, ed);
      
      let maxDays = 180;
      while (curr <= end && maxDays > 0) {
        if (daysOfWeek.includes(curr.getDay())) {
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
    let newSchedulesToCreate = [];
    const now = new Date();
    const schSheet = getSheet(CONFIG.SHEETS.SCHEDULES);
    const existingSchedules = sheetToObjects(schSheet);
    
    for (let d of datesToBook) {
      const [y, mm, dd] = d.split('-').map(Number);
      const [hh, min] = stTime.split(':').map(Number);
      const bookingStartDateTime = new Date(y, mm - 1, dd, hh, min);
      
      if (bookingStartDateTime <= now) { skippedDates.push(d); continue; }
      
      if (technicianId === 'SPA_ASSIGN') {
        // Logic kiểm tra cho "Spa sắp xếp"
        const allTechs = sheetToObjects(getSheet(CONFIG.SHEETS.TECHNICIANS)).filter(t => isActive(t.isActive));
        const eligibleTechs = serviceId ? allTechs.filter(t => t.specialties && String(t.specialties).split(',').map(s=>s.trim()).includes(serviceId)) : allTechs;
        
        const schSheet = getSheet(CONFIG.SHEETS.SCHEDULES);
        const allSchedules = sheetToObjects(schSheet).filter(s => normalizeDate(s.date) === d && isActive(s.isActive));
        
        let foundAnyAvailable = false;
        for (let tech of eligibleTechs) {
          const sch = allSchedules.find(sc => String(sc.technicianId).trim() === tech.technicianId);
          const sStart = sch ? timeToMinutes(normalizeTime(sch.startTime)) : timeToMinutes('08:00');
          const sEnd = sch ? timeToMinutes(normalizeTime(sch.endTime)) : timeToMinutes('23:00');
          
          if (sMin < sStart || eMin > sEnd) continue;
          
          const isBusy = existingBookings.filter(b => String(b.technicianId).trim() === tech.technicianId && normalizeDate(b.bookingDate) === d).some(b => {
            const bs = timeToMinutes(normalizeTime(b.startTime)), be = timeToMinutes(normalizeTime(b.endTime));
            return !(eMin <= bs || sMin >= be);
          });
          
          if (!isBusy) { foundAnyAvailable = true; break; }
        }
        
        if (!foundAnyAvailable) { skippedDates.push(d); continue; }
      } else {
        const existingForDay = existingBookings.filter(b => String(b.technicianId).trim()===technicianId && normalizeDate(b.bookingDate)===d);
        if (existingForDay.some(b=>{ 
          const bs=timeToMinutes(normalizeTime(b.startTime)),be=timeToMinutes(normalizeTime(b.endTime));
          const isConflict = !(eMin<=bs||sMin>=be);
          if (isConflict) {
            if (b.customerId === customerId && b.serviceId === serviceId && normalizeTime(b.startTime) === stTime) {
              return false;
            }
            return true;
          }
          return false;
        })) {
          skippedDates.push(d); continue;
        }
      }
      
      const bookingId = generateId('BKG');
      const booking = { bookingId, customerId, serviceId, technicianId, bookingDate: d, startTime: stTime, endTime, status:'confirmed', note: note||'', createdAt: new Date().toISOString() };
      successfulBookings.push(booking);
      existingBookings.push(booking);
      
      if (technicianId !== 'SPA_ASSIGN') {
        const existingSch = existingSchedules.find(s => String(s.technicianId).trim() === technicianId && normalizeDate(s.date) === d);
        if (!existingSch) {
          const newSch = { scheduleId: generateId('SCH'), technicianId: technicianId, date: d, startTime: '08:00', endTime: '23:00', isActive: true };
          newSchedulesToCreate.push(newSch);
          existingSchedules.push(newSch);
        }
      }
      
      try { notifyNewBooking(booking); } catch(e) { console.error('Notification failed', e.message); }
    }
    
    if (successfulBookings.length === 0) return { success: false, error: 'slot_taken' };

    const bHeaders = getHeaders(bSheet);
    const bValues = successfulBookings.map(b => bHeaders.map(h => {
      let val = b[h] !== undefined ? b[h] : '';
      if (h === 'phone') return "'" + val;
      return val;
    }));
    bSheet.getRange(bSheet.getLastRow() + 1, 1, bValues.length, bHeaders.length).setValues(bValues);

    if (newSchedulesToCreate.length > 0) {
      const schHeaders = getHeaders(schSheet);
      const schValues = newSchedulesToCreate.map(s => schHeaders.map(h => s[h] !== undefined ? s[h] : ''));
      schSheet.getRange(schSheet.getLastRow() + 1, 1, schValues.length, schHeaders.length).setValues(schValues);
    }
    
    try { refreshCustomerTotalVisits(customerId); } catch(e) {}
    
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
    const enriched = bookings.map(b => ({ 
      ...b, 
      bookingDate: normalizeDate(b.bookingDate), 
      startTime: normalizeTime(b.startTime), 
      endTime: normalizeTime(b.endTime), 
      service: services.find(s=>s.serviceId===b.serviceId)||{}, 
      technician: b.technicianId === 'SPA_ASSIGN' ? { technicianId: 'SPA_ASSIGN', nameVi: 'Spa sắp xếp', nameEn: 'Spa arranges' } : (techs.find(t=>t.technicianId===b.technicianId)||{}) 
    }));
    enriched.sort((a,b) => (a.bookingDate + 'T' + a.startTime).localeCompare(b.bookingDate + 'T' + b.startTime));
    let totalVisits = countCustomerVisits(bookings, customerId);
    try { totalVisits = refreshCustomerTotalVisits(customerId); } catch(e) {}
    return { success: true, bookings: enriched, totalVisits };
  } catch(e) { return { success: false, error: e.message }; }
}

function handleCancelBooking(payload) {
  const { bookingId, customerId } = payload;
  const sheet = getSheet(CONFIG.SHEETS.BOOKINGS);
  const bookings = sheetToObjects(sheet); const headers = getHeaders(sheet);
  const idx = bookings.findIndex(b => b.bookingId===bookingId && b.customerId===customerId);
  if (idx===-1) return { success: false, error: 'not_found' };
  if (bookings[idx].status==='cancelled') return { success: false, error: 'already_cancelled' };
  bookings[idx].status = 'cancelled'; 
  updateRow(sheet, idx, headers, bookings[idx]);
  try { refreshCustomerTotalVisits(customerId); } catch(e) {}
  
  try {
    notifyCancelBooking(bookings[idx]);
  } catch(e) {
    console.error('Cancellation notification failed', e.message);
  }
  
  return { success: true };
}

// ── REFERRAL ──────────────────────────────────────────────────
function handleGetReferralInfo(payload) {
  const { customerId } = payload;
  const customers = sheetToObjects(getSheet(CONFIG.SHEETS.CUSTOMERS));
  const c = customers.find(c => c.customerId===customerId);
  if (!c) return { success: false, error: 'not_found' };
  let totalVisits = parseInt(c.totalVisits) || 0;
  try { totalVisits = refreshCustomerTotalVisits(customerId); } catch(e) {}
  return { success: true, referralCode: c.referralCode, referralCount: parseInt(c.referralCount)||0, totalVisits };
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
  const { username, password } = payload;
  if (username === CONFIG.ADMIN.USERNAME && password === CONFIG.ADMIN.PASSWORD)
    return { success: true, token: CONFIG.ADMIN.USERNAME + ':' + hashPassword(password), admin: { name: 'Super Admin' } };
  return { success: false, error: 'wrong_credentials' };
}

function handleAdminGetAllBookings(payload) {
  if (!verifyAdmin(payload)) return { success: false, error: 'unauthorized' };
  try {
    const bookings = sheetToObjects(getSheet(CONFIG.SHEETS.BOOKINGS));
    const services = sheetToObjects(getSheet(CONFIG.SHEETS.SERVICES));
    const techs = sheetToObjects(getSheet(CONFIG.SHEETS.TECHNICIANS));
    const customers = sheetToObjects(getSheet(CONFIG.SHEETS.CUSTOMERS));
    const enriched = bookings.map(b => ({ 
      ...b, 
      bookingDate: normalizeDate(b.bookingDate), 
      startTime: normalizeTime(b.startTime), 
      endTime: normalizeTime(b.endTime), 
      service: services.find(s=>s.serviceId===b.serviceId)||{}, 
      technician: b.technicianId === 'SPA_ASSIGN' ? { technicianId: 'SPA_ASSIGN', nameVi: 'Spa sắp xếp', nameEn: 'Spa arranges' } : (techs.find(t=>t.technicianId===b.technicianId)||{}), 
      customer: sanitizeCustomer(customers.find(c=>c.customerId===b.customerId)||{}) 
    }));
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
    const sheet = getSheet(CONFIG.SHEETS.SERVICES); const all = sheetToObjects(sheet);
    const idx = all.findIndex(s => s.serviceId===payload.serviceId);
    if (idx===-1) return { success: false, error: 'not_found' };
    deleteRow(sheet, idx); return { success: true };
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
    const sheet = getSheet(CONFIG.SHEETS.TECHNICIANS); const all = sheetToObjects(sheet);
    const idx = all.findIndex(t => t.technicianId===payload.technicianId);
    if (idx===-1) return { success: false, error: 'not_found' };
    deleteRow(sheet, idx); return { success: true };
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
    const sheet = getSheet(CONFIG.SHEETS.SCHEDULES); const all = sheetToObjects(sheet);
    const idx = all.findIndex(s => s.scheduleId===payload.scheduleId);
    if (idx===-1) return { success: false, error: 'not_found' };
    deleteRow(sheet, idx); return { success: true };
  } catch(e) { return { success: false, error: e.message }; }
}

// ── NOTIFICATIONS ───────────────────────────────────────────
function notifyNewBooking(booking) {
  const service = sheetToObjects(getSheet(CONFIG.SHEETS.SERVICES)).find(s => s.serviceId === booking.serviceId) || {};
  const tech = sheetToObjects(getSheet(CONFIG.SHEETS.TECHNICIANS)).find(t => t.technicianId === booking.technicianId) || {};
  const customer = sheetToObjects(getSheet(CONFIG.SHEETS.CUSTOMERS)).find(c => c.customerId === booking.customerId) || {};
  const technicianName = booking.technicianId === 'SPA_ASSIGN' ? 'Spa sắp xếp' : (tech.nameVi || booking.technicianId);
  
  const msg = `🔔 *CÓ LỊCH ĐẶT MỚI!*\n\n` +
              `👤 *Khách:* ${customer.name} (${customer.phone})\n` +
              `💆 *Dịch vụ:* ${service.nameVi || booking.serviceId}\n` +
              `👩‍⚕️ *Kỹ thuật viên:* ${technicianName}\n` +
              `📅 *Ngày:* ${normalizeDate(booking.bookingDate)}\n` +
              `⏰ *Giờ:* ${normalizeTime(booking.startTime)} - ${normalizeTime(booking.endTime)}\n` +
              `📝 *Ghi chú:* ${booking.note || 'Không có'}`;
  
  sendTelegramMessage(msg);
}

function notifyCancelBooking(booking) {
  const service = sheetToObjects(getSheet(CONFIG.SHEETS.SERVICES)).find(s => s.serviceId === booking.serviceId) || {};
  const tech = sheetToObjects(getSheet(CONFIG.SHEETS.TECHNICIANS)).find(t => t.technicianId === booking.technicianId) || {};
  const customer = sheetToObjects(getSheet(CONFIG.SHEETS.CUSTOMERS)).find(c => c.customerId === booking.customerId) || {};
  const technicianName = booking.technicianId === 'SPA_ASSIGN' ? 'Spa sắp xếp' : (tech.nameVi || booking.technicianId);
  
  const msg = `❌ *THÔNG BÁO HỦY LỊCH!*\n\n` +
              `👤 *Khách:* ${customer.name} (${customer.phone})\n` +
              `💆 *Dịch vụ:* ${service.nameVi || booking.serviceId}\n` +
              `👩‍⚕️ *Kỹ thuật viên:* ${technicianName}\n` +
              `📅 *Ngày:* ${normalizeDate(booking.bookingDate)}\n` +
              `⏰ *Giờ:* ${normalizeTime(booking.startTime)} - ${normalizeTime(booking.endTime)}`;
  
  sendTelegramMessage(msg);
}

function sendTelegramMessage(text) {
  if (CONFIG.TELEGRAM.TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN') return;
  const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM.TOKEN}/sendMessage`;
  const payload = { chat_id: CONFIG.TELEGRAM.CHAT_ID, text: text, parse_mode: 'Markdown' };
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const code = resp.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('telegram_http_' + code + ': ' + resp.getContentText());
  }
}

function sendTelegramReply(chatId, text) {
  if (CONFIG.TELEGRAM.TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN') return;
  const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM.TOKEN}/sendMessage`;
  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' }),
    muteHttpExceptions: true
  });
}

// ── TELEGRAM BOT COMMANDS ────────────────────────────────────
function setTelegramWebhook() {
  const webhookUrl = ScriptApp.getService().getUrl();
  const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM.TOKEN}/setWebhook`;
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ url: webhookUrl }),
    muteHttpExceptions: true
  });
  Logger.log('setWebhook result: ' + resp.getContentText());
}

function handleTelegramUpdate(update) {
  const msg = update.message || update.edited_message;
  if (!msg || !msg.text) return;

  const chatId = String(msg.chat.id);
  if (chatId !== CONFIG.TELEGRAM.CHAT_ID) return;

  const text = msg.text.trim();

  // /next N — N lịch sắp tới (1~20), mặc định 5
  const nextMatch = text.match(/^\/next(?:@\S+)?(?:\s+(\d+))?/i);
  if (nextMatch) {
    const raw = parseInt(nextMatch[1]);
    const n = isNaN(raw) ? 5 : Math.min(Math.max(raw, 1), 20);
    sendTelegramReply(chatId, buildNextBookingsMessage(n));
    return;
  }

  // /sumtoday — tổng kết hôm nay
  if (/^\/sumtoday(?:@\S+)?$/i.test(text)) {
    sendTelegramReply(chatId, buildSumTodayMessage());
    return;
  }
}

function buildNextBookingsMessage(n) {
  try {
    const now = new Date();
    const todayStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
    const nowTime = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');

    const services  = sheetToObjects(getSheet(CONFIG.SHEETS.SERVICES));
    const techs     = sheetToObjects(getSheet(CONFIG.SHEETS.TECHNICIANS));
    const customers = sheetToObjects(getSheet(CONFIG.SHEETS.CUSTOMERS));

    const upcoming = sheetToObjects(getSheet(CONFIG.SHEETS.BOOKINGS))
      .filter(b => b.status !== 'cancelled')
      .map(b => ({ ...b, bookingDate: normalizeDate(b.bookingDate), startTime: normalizeTime(b.startTime), endTime: normalizeTime(b.endTime) }))
      .filter(b => b.bookingDate > todayStr || (b.bookingDate === todayStr && b.startTime >= nowTime))
      .sort((a, b) => (a.bookingDate + 'T' + a.startTime).localeCompare(b.bookingDate + 'T' + b.startTime))
      .slice(0, n);

    if (upcoming.length === 0) return '📋 Không có lịch sắp tới.';

    let msg = `📋 *${upcoming.length} LỊCH SẮP TỚI:*\n`;
    upcoming.forEach((b, i) => {
      const svc  = services.find(s => s.serviceId === b.serviceId) || {};
      const tech = b.technicianId === 'SPA_ASSIGN' ? { nameVi: 'Spa sắp xếp' } : (techs.find(t => t.technicianId === b.technicianId) || {});
      const cust = customers.find(c => c.customerId === b.customerId) || {};
      msg += `\n${i+1}. 📅 *${b.bookingDate}* ⏰ ${b.startTime}–${b.endTime}\n`;
      msg += `   💆 ${svc.nameVi || b.serviceId}\n`;
      msg += `   👤 ${cust.name || '?'} | 👩‍⚕️ ${tech.nameVi || b.technicianId}`;
    });
    return msg;
  } catch(e) {
    return '❌ Lỗi khi lấy danh sách lịch: ' + e.message;
  }
}

function buildSumTodayMessage() {
  try {
    const now = new Date();
    const todayStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
    const dateDisplay = now.getDate() + '/' + (now.getMonth()+1) + '/' + now.getFullYear();

    const services = sheetToObjects(getSheet(CONFIG.SHEETS.SERVICES));
    const bookings = sheetToObjects(getSheet(CONFIG.SHEETS.BOOKINGS))
      .filter(b => normalizeDate(b.bookingDate) === todayStr && b.status !== 'cancelled');

    let totalRevenue = 0;
    bookings.forEach(b => {
      const svc = services.find(s => s.serviceId === b.serviceId) || {};
      totalRevenue += parseInt(svc.price) || 0;
    });

    const formatVND = n => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') + 'đ';

    return `📊 *TỔNG KẾT HÔM NAY (${dateDisplay}):*\n\n` +
           `✅ Số lịch: *${bookings.length}* dịch vụ\n` +
           `💰 Doanh thu dự kiến: *${formatVND(totalRevenue)}*`;
  } catch(e) {
    return '❌ Lỗi khi tính tổng: ' + e.message;
  }
}

// ── SETUP TOOL ──────────────────────────────────────────────
function runSetupTool() {
  setupServicesData();
  return { success: true, message: 'Services synchronized with backend.' };
}

function setupServicesData() {
  const sheet = getSheet(CONFIG.SHEETS.SERVICES);
  const headers = getHeaders(sheet);
  const lr = sheet.getLastRow();
  if (lr > 1) sheet.getRange(2, 1, lr - 1, sheet.getLastColumn()).clearContent();
  
  const services = [
    { serviceId: 'H1', nameVi: 'Nhẹ (H1)', nameEn: 'Light Hair Wash', duration: 45, price: 70000, isActive: true },
    { serviceId: 'H2', nameVi: 'Thả Lỏng (H2)', nameEn: 'Relaxing Hair Wash', duration: 90, price: 179000, isActive: true },
    { serviceId: 'H3', nameVi: 'Phục Hồi (H3)', nameEn: 'Recovery Hair Wash', duration: 120, price: 269000, isActive: true },
    { serviceId: 'H4', nameVi: 'Trọn Vẹn (H4)', nameEn: 'Complete Hair Wash', duration: 150, price: 299000, isActive: true },
    { serviceId: 'SO1', nameVi: 'Sạch & Cân Bằng (SO1)', nameEn: 'Clean & Balance', duration: 60, price: 449000, isActive: true },
    { serviceId: 'SO2', nameVi: 'Điều Trị & Phục Hồi (SO2)', nameEn: 'Treatment & Recovery', duration: 100, price: 499000, isActive: true },
    { serviceId: 'SO3', nameVi: 'Mụn Vùng Lưng (SO3)', nameEn: 'Back Acne Treatment', duration: 90, price: 449000, isActive: true },
    { serviceId: 'SO4', nameVi: 'Cá Nhân Hóa (SO4)', nameEn: 'Personalized Acne Care', duration: 80, price: 549000, isActive: true },
    { serviceId: 'SD1', nameVi: 'Cấp Ẩm & Làm Dịu (SD1)', nameEn: 'Hydrate & Soothe', duration: 60, price: 399000, isActive: true },
    { serviceId: 'SD2', nameVi: 'Cấp Ẩm Sâu (SD2)', nameEn: 'Deep Hydration', duration: 100, price: 449000, isActive: true },
    { serviceId: 'SD3', nameVi: 'Sáng Da & Phục Hồi (SD3)', nameEn: 'Brighten & Recover', duration: 90, price: 649000, isActive: true },
    { serviceId: 'SD4', nameVi: 'Cá Nhân Hóa (SD4)', nameEn: 'Personalized Skin Care', duration: 120, price: 699000, isActive: true },
    { serviceId: 'SA1', nameVi: 'Dưỡng Ẩm & Thư Giãn (SA1)', nameEn: 'Moisturize & Relax', duration: 60, price: 449000, isActive: true },
    { serviceId: 'SA2', nameVi: 'Săn Chắc & Đàn Hồi (SA2)', nameEn: 'Firming & Elasticity', duration: 90, price: 699000, isActive: true },
    { serviceId: 'SA3', nameVi: 'Nâng Cơ Chuyên Sâu (SA3)', nameEn: 'Advanced Lifting', duration: 120, price: 749000, isActive: true },
    { serviceId: 'SA4', nameVi: 'Cá Nhân Hóa (SA4)', nameEn: 'Personalized Anti-Aging', duration: 120, price: 799000, isActive: true },
    { serviceId: 'BS', nameVi: 'Sáng Mịn (BS)', nameEn: 'Bright & Smooth', duration: 45, price: 199000, isActive: true },
    { serviceId: 'BW', nameVi: 'Sáng Ẩm (BW)', nameEn: 'Bright & Moist', duration: 90, price: 399000, isActive: true },
    { serviceId: 'CB', nameVi: 'Dưỡng Thể Toàn Diện (CB)', nameEn: 'Full Body Care', duration: 150, price: 499000, isActive: true },
    { serviceId: 'B1', nameVi: 'Thư Giãn Vùng Tay (B1)', nameEn: 'Hand Relaxation', duration: 30, price: 99000, isActive: true },
    { serviceId: 'B2', nameVi: 'Thư Giãn Vùng Chân (B2)', nameEn: 'Leg Relaxation', duration: 60, price: 129000, isActive: true },
    { serviceId: 'B3', nameVi: 'Giải Tỏa Vai Gáy (B3)', nameEn: 'Shoulder & Neck Relief', duration: 90, price: 259000, isActive: true },
    { serviceId: 'B4', nameVi: 'Thư Giãn Toàn Thân (B4)', nameEn: 'Full Body Relaxation', duration: 130, price: 399000, isActive: true }
  ];
  services.forEach(svc => appendRow(sheet, headers, svc));
}

// ── SYNC DATA TOOL ──────────────────────────────────────────
function syncTotalVisits() {
  const bSheet = getSheet(CONFIG.SHEETS.BOOKINGS);
  const bookings = sheetToObjects(bSheet);
  
  // Count only bookings that are NOT cancelled (or just confirmed/completed)
  const visitCounts = {};
  bookings.forEach(b => {
    if (b.status === 'confirmed' || b.status === 'completed') {
      visitCounts[b.customerId] = (visitCounts[b.customerId] || 0) + 1;
    }
  });
  
  const cSheet = getSheet(CONFIG.SHEETS.CUSTOMERS);
  const customers = sheetToObjects(cSheet);
  const headers = getHeaders(cSheet);
  
  let updatedCount = 0;
  customers.forEach((c, idx) => {
    const actualVisits = visitCounts[c.customerId] || 0;
    if (parseInt(c.totalVisits || 0) !== actualVisits) {
      c.totalVisits = actualVisits;
      updateRow(cSheet, idx, headers, c);
      updatedCount++;
    }
  });
  
  return `Đã đồng bộ lại tổng lượt (totalVisits) cho ${updatedCount} khách hàng thành công!`;
}
