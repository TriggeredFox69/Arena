const API = 'http://localhost:5000/api';

async function post(endpoint, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
  return res.json();
}
async function get(endpoint, token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + endpoint, { headers });
  return res.json();
}

async function register(name) {
  const phone = `+92300${String(Math.floor(Math.random() * 10000000)).padStart(7, '0')}`;
  return post('/auth/register', {
    username: name,
    email: `${name}@example.com`,
    phone,
    password: 'password123'
  });
}

async function pollStatus(token, label) {
  for (let i = 0; i < 10; i++) {
    const r = await get('/matchmaking/status', token);
    console.log(`${label} poll ${i}:`, r.matched, r.inQueue ? r.inQueue.position : null);
    if (r.matched) return r;
    await new Promise(res => setTimeout(res, 500));
  }
  return null;
}

async function main() {
  const suffix = Date.now();
  const a = await register(`mma_${suffix}`);
  const b = await register(`mmb_${suffix}`);
  console.log('A register:', a.success, a.error || a.message);
  console.log('B register:', b.success, b.error || b.message);
  if (!a.token || !b.token) return;

  // A joins first, should queue
  const joinA = await post('/matchmaking/join', { gameKey: 'chess', wager: 10 }, a.token);
  console.log('A join:', joinA.matched, joinA.message);

  // B joins, should match immediately
  const joinB = await post('/matchmaking/join', { gameKey: 'chess', wager: 10 }, b.token);
  console.log('B join:', joinB.matched, joinB.role, joinB.roomCode, joinB.message);

  if (!joinB.matched) {
    const matchedB = await pollStatus(b.token, 'B');
    console.log('B matched via poll:', matchedB?.matched, matchedB?.roomCode, matchedB?.role);
  }
  if (joinA.matched) {
    console.log('A matched in response:', joinA.matched, joinA.role, joinA.roomCode);
  } else {
    const matchedA = await pollStatus(a.token, 'A');
    console.log('A matched via poll:', matchedA?.matched, matchedA?.roomCode, matchedA?.role);
  }
}

main().catch(e => console.error(e));
