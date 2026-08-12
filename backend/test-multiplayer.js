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

async function main() {
  const suffix = Date.now();
  const a = await register(`mpuserA_${suffix}`);
  const b = await register(`mpuserB_${suffix}`);
  console.log('A register:', a.success, a.error || a.message);
  console.log('B register:', b.success, b.error || b.message);
  if (!a.token || !b.token) return;

  console.log('A balance:', a.user?.balance, 'B balance:', b.user?.balance);

  // Create room as A
  const create = await post('/rooms/create', { gameKey: 'chess', wager: 10 }, a.token);
  console.log('Create room:', JSON.stringify(create, null, 2));
  if (!create.success) return;
  const code = create.room.roomCode;

  // Join as B
  const join = await post('/rooms/join', { roomCode: code }, b.token);
  console.log('Join room:', JSON.stringify(join, null, 2));

  // Ready as B
  const readyB = await post('/rooms/ready', { roomCode: code }, b.token);
  console.log('Ready B:', JSON.stringify(readyB, null, 2));

  // Ready as A
  const readyA = await post('/rooms/ready', { roomCode: code }, a.token);
  console.log('Ready A:', JSON.stringify(readyA, null, 2));

  // Sync
  const sync = await get(`/rooms/sync?code=${code}`, a.token);
  console.log('Sync:', JSON.stringify(sync, null, 2));
}

main().catch(e => console.error(e));
