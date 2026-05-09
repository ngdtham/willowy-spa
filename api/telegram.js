const GAS_URL =
  'https://script.google.com/macros/s/AKfycbzyfSdGC1HTLaZWeU5HeuyEuCWfFdgcCA9sOWeliJ42W4oH5ishONdenSnc0ZSSyyg5/exec';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true });
  }

  try {
    await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      redirect: 'follow',
      signal: AbortSignal.timeout(25000),
    });
  } catch (e) {
    console.error('GAS relay error:', e.message);
  }

  return res.status(200).send('OK');
};
