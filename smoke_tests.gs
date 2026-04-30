/**
 * SMOKE TESTS for Willowy Spa
 * Run these functions from the GAS Editor to verify backend logic.
 */

function runAllSmokeTests() {
  console.log('--- STARTING SMOKE TESTS ---');
  test_AuthFlow();
  test_BookingFlow();
  test_AdminSecurity();
  console.log('--- ALL TESTS COMPLETED ---');
}

function test_AuthFlow() {
  console.log('Testing Auth Flow...');
  
  // 1. Setup
  handleSetup();
  
  // 2. Login as default admin
  const adminRes = handleAdminLogin({ 
    username: CONFIG.ADMIN.USERNAME, 
    password: CONFIG.ADMIN.PASSWORD 
  });
  if (!adminRes.success) throw new Error('Admin login failed: ' + adminRes.error);
  console.log('✅ Admin Login Success');
  
  // 3. Verify Session
  const isValid = validateSession(adminRes.token, 'admin');
  if (!isValid) throw new Error('Session validation failed');
  console.log('✅ Session Validation Success');
}

function test_BookingFlow() {
  console.log('Testing Booking Flow...');
  
  // 1. Create a technician and a service if they don't exist
  const svcId = 'TEST_SVC_' + Date.now();
  handleAdminSaveService({
    token: createSession('SYSTEM', 'admin'),
    service: { serviceId: svcId, nameVi: 'Test Service', price: 1000, duration: 60, isActive: true }
  });
  
  const techId = 'TEST_TECH_' + Date.now();
  handleAdminSaveTechnician({
    token: createSession('SYSTEM', 'admin'),
    technician: { technicianId: techId, nameVi: 'Test Tech', isActive: true, specialties: svcId }
  });
  
  // 2. Try to get slots without schedule (should fail/be empty)
  const today = new Date().toISOString().split('T')[0];
  const slotsRes = handleGetAvailableSlots({ technicianId: techId, date: today, serviceId: svcId });
  if (slotsRes.success !== false || slotsRes.error !== 'no_schedule') {
    throw new Error('Should have failed with no_schedule, got: ' + JSON.stringify(slotsRes));
  }
  console.log('✅ Strict Schedule Policy Verified (No Schedule = No Slots)');
  
  // 3. Create a schedule
  handleAdminSaveSchedule({
    token: createSession('SYSTEM', 'admin'),
    schedule: { technicianId: techId, date: today, startTime: '09:00', endTime: '12:00', isActive: true }
  });
  
  // 4. Try to get slots again
  const slotsRes2 = handleGetAvailableSlots({ technicianId: techId, date: today, serviceId: svcId });
  if (!slotsRes2.success || slotsRes2.slots.length === 0) {
    throw new Error('Should have slots now, got: ' + JSON.stringify(slotsRes2));
  }
  console.log('✅ Slots Available After Schedule Creation');
}

function test_AdminSecurity() {
  console.log('Testing Admin Security...');
  
  // Try an admin action with invalid token
  const res = handleAdminGetAllBookings({ token: 'INVALID_TOKEN' });
  if (res.success !== false || res.error !== 'unauthorized') {
    throw new Error('Admin action should have failed with unauthorized');
  }
  console.log('✅ Admin Security Verified');
}
