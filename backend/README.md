# ArenaX Backend API

Complete backend API for the ArenaX gaming platform with authentication, wallet management, and game tracking.

## Features

- **User Authentication**: JWT-based registration and login
- **Wallet Management**: Deposit, withdraw, and transaction tracking
- **Game Management**: Start/end games, track history and stats
- **Security**: Helmet, rate limiting, input validation
- **Database Transactions**: ACID compliance for financial operations
- **Pakistani Payment Support**: EasyPaisa & JazzCash integration ready

## Tech Stack

- Node.js + Express
- MongoDB + Mongoose
- JWT Authentication
- bcryptjs for password hashing
- Express Validator for input validation
- Helmet for security headers
- Rate limiting for API protection

## Setup

### Prerequisites

- Node.js (v16+)
- MongoDB (local or Atlas)

### Installation

1. Install dependencies:
```bash
cd backend
npm install
```

2. Create `.env` file:
```bash
cp .env.example .env
```

3. Configure environment variables in `.env`:
```env
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/arenax
JWT_SECRET=your_secure_jwt_secret_here
JWT_EXPIRE=7d
COIN_PRICE=10
FRONTEND_URL=http://localhost:3000
```

4. Start MongoDB:
```bash
mongod
```

5. Start the server:
```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm start
```

Server will run at `http://localhost:5000`

## API Endpoints

### Authentication (`/api/auth`)

#### Register
```http
POST /api/auth/register
Content-Type: application/json

{
  "username": "player123",
  "email": "player@example.com",
  "phone": "03001234567",
  "password": "secure123"
}
```

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "player@example.com",
  "password": "secure123"
}
```

#### Get Current User
```http
GET /api/auth/me
Authorization: Bearer <token>
```

#### Update Profile
```http
PUT /api/auth/update-profile
Authorization: Bearer <token>
Content-Type: application/json

{
  "username": "newusername",
  "phone": "03009876543"
}
```

### Wallet (`/api/wallet`)

#### Get Balance
```http
GET /api/wallet/balance
Authorization: Bearer <token>
```

#### Deposit
```http
POST /api/wallet/deposit
Authorization: Bearer <token>
Content-Type: application/json

{
  "method": "easypaisa",
  "amount": 100,
  "accountNumber": "03001234567"
}
```

#### Withdraw
```http
POST /api/wallet/withdraw
Authorization: Bearer <token>
Content-Type: application/json

{
  "method": "jazzcash",
  "coins": 10,
  "accountNumber": "03001234567"
}
```

#### Get Transactions
```http
GET /api/wallet/transactions?page=1&limit=20
Authorization: Bearer <token>
```

### Games (`/api/games`)

#### Start Game
```http
POST /api/games/start
Authorization: Bearer <token>
Content-Type: application/json

{
  "game": "Lightning Spin"
}
```

#### End Game
```http
POST /api/games/end
Authorization: Bearer <token>
Content-Type: application/json

{
  "game": "Lightning Spin",
  "won": true,
  "coinsWon": 10,
  "gameData": {
    "symbols": ["cherry", "cherry", "cherry"]
  }
}
```

#### Get Game History
```http
GET /api/games/history?page=1&limit=20&game=Lightning Spin
Authorization: Bearer <token>
```

#### Get Game Stats
```http
GET /api/games/stats
Authorization: Bearer <token>
```

## Response Format

### Success Response
```json
{
  "success": true,
  "message": "Operation successful",
  "data": {}
}
```

### Error Response
```json
{
  "success": false,
  "message": "Error description",
  "errors": []
}
```

## Game Names

Valid game names for API requests:
- `Lightning Spin`
- `Gold Rush Roulette`
- `Arena Dice Master`

## Payment Methods

Valid payment methods:
- `easypaisa`
- `jazzcash`

## Database Models

### User
- username, email, phone (unique)
- password (hashed)
- coins, totalDeposited, totalWithdrawn, totalWon
- gamesPlayed, gamesWon, level
- timestamps

### Transaction
- user (ref)
- type (credit/debit)
- amount, rupees
- source (deposit/withdrawal/game_entry/game_win)
- method, accountNumber
- status (pending/completed/failed)
- balanceAfter

### GameHistory
- user (ref)
- game name
- entryFee
- won, coinsWon, rupeesWon
- balanceBefore, balanceAfter
- gameData (flexible object)
- timestamps

## Security Features

- Password hashing with bcrypt
- JWT authentication
- Rate limiting (100 requests per 15 minutes)
- Input validation on all endpoints
- Helmet security headers
- CORS configuration
- Database transactions for financial operations
- Protected routes with auth middleware

## Error Codes

- `400` - Bad Request (validation errors)
- `401` - Unauthorized (invalid/missing token)
- `403` - Forbidden (account deactivated)
- `404` - Not Found (resource doesn't exist)
- `500` - Internal Server Error

## Development

### Testing with cURL

Register:
```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"test","email":"test@test.com","phone":"03001234567","password":"test123"}'
```

Login:
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"test123"}'
```

Get Balance:
```bash
curl -X GET http://localhost:5000/api/wallet/balance \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

## Future Enhancements

- [ ] Actual EasyPaisa/JazzCash payment gateway integration
- [ ] Admin panel for withdrawal approvals
- [ ] Email verification
- [ ] Phone OTP verification
- [ ] WebSocket support for real-time updates
- [ ] Leaderboards
- [ ] Referral system
- [ ] Tournament system

## License

MIT
