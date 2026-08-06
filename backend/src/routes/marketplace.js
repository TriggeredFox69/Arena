/* ==========================================================================
   ARENAX BACKEND - MARKETPLACE ROUTES
   Peer-to-peer exchange: create orders, match trades, cancel orders
   ========================================================================== */

const express = require('express');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const { notifyOrderFilled } = require('../socket');

// Get order book (all open orders)
router.get('/orders', authMiddleware, (req, res) => {
  try {
    const buyOrders = db.prepare(`
      SELECT o.id, o.user_id, u.username, o.amount_ax, o.filled_amount,
             o.price_per_ax, o.total_value, o.created_at
      FROM marketplace_orders o
      JOIN users u ON o.user_id = u.id
      WHERE o.type = 'buy' AND o.status IN ('open', 'partial')
      ORDER BY o.price_per_ax DESC, o.created_at ASC
      LIMIT 50
    `).all();

    const sellOrders = db.prepare(`
      SELECT o.id, o.user_id, u.username, o.amount_ax, o.filled_amount,
             o.price_per_ax, o.total_value, o.created_at
      FROM marketplace_orders o
      JOIN users u ON o.user_id = u.id
      WHERE o.type = 'sell' AND o.status IN ('open', 'partial')
      ORDER BY o.price_per_ax ASC, o.created_at ASC
      LIMIT 50
    `).all();

    res.json({ buyOrders, sellOrders });
  } catch (err) {
    console.error('Get orders error:', err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Create order (buy or sell)
router.post('/order', authMiddleware, (req, res) => {
  try {
    const { type, amountAx, pricePerAx } = req.body;

    if (!['buy', 'sell'].includes(type)) {
      return res.status(400).json({ error: 'Invalid order type' });
    }

    if (amountAx <= 0 || pricePerAx <= 0) {
      return res.status(400).json({ error: 'Invalid amount or price' });
    }

    const totalValue = amountAx * pricePerAx;

    // Check balance
    const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.userId);

    if (type === 'sell' && user.balance < amountAx) {
      return res.status(400).json({ error: 'Insufficient AX balance' });
    }

    // Lock balance for sell orders
    if (type === 'sell') {
      db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?')
        .run(amountAx, req.userId);
    }

    // Insert order
    const result = db.prepare(`
      INSERT INTO marketplace_orders (user_id, type, amount_ax, price_per_ax, total_value)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.userId, type, amountAx, pricePerAx, totalValue);

    const orderId = result.lastInsertRowid;

    // Try to match with existing orders
    matchOrders(orderId, type);

    res.json({ success: true, orderId, message: 'Order placed' });
  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// Match orders
function matchOrders(newOrderId, newOrderType) {
  try {
    const newOrder = db.prepare('SELECT * FROM marketplace_orders WHERE id = ?').get(newOrderId);
    if (!newOrder || newOrder.status === 'filled') return;

    const oppositeType = newOrderType === 'buy' ? 'sell' : 'buy';
    const remainingAmount = newOrder.amount_ax - newOrder.filled_amount;

    // Find matching orders
    const matchingOrders = db.prepare(`
      SELECT * FROM marketplace_orders
      WHERE type = ? AND status IN ('open', 'partial')
      ${newOrderType === 'buy' ? 'AND price_per_ax <= ?' : 'AND price_per_ax >= ?'}
      ORDER BY ${newOrderType === 'buy' ? 'price_per_ax ASC' : 'price_per_ax DESC'}, created_at ASC
    `).all(oppositeType, newOrder.price_per_ax);

    let filled = 0;

    for (const matchOrder of matchingOrders) {
      if (filled >= remainingAmount) break;

      const matchRemaining = matchOrder.amount_ax - matchOrder.filled_amount;
      const tradeAmount = Math.min(remainingAmount - filled, matchRemaining);
      const tradePrice = matchOrder.price_per_ax;
      const tradeValue = tradeAmount * tradePrice;

      const buyerId = newOrderType === 'buy' ? newOrder.user_id : matchOrder.user_id;
      const sellerId = newOrderType === 'sell' ? newOrder.user_id : matchOrder.user_id;
      const buyOrderId = newOrderType === 'buy' ? newOrderId : matchOrder.id;
      const sellOrderId = newOrderType === 'sell' ? newOrderId : matchOrder.id;

      // Execute trade
      db.transaction(() => {
        // Record trade
        db.prepare(`
          INSERT INTO trades (buy_order_id, sell_order_id, buyer_id, seller_id, amount_ax, price_per_ax, total_value)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(buyOrderId, sellOrderId, buyerId, sellerId, tradeAmount, tradePrice, tradeValue);

        // Transfer AX tokens
        db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(tradeAmount, buyerId);

        // Update order filled amounts
        db.prepare('UPDATE marketplace_orders SET filled_amount = filled_amount + ? WHERE id = ?')
          .run(tradeAmount, newOrderId);
        db.prepare('UPDATE marketplace_orders SET filled_amount = filled_amount + ? WHERE id = ?')
          .run(tradeAmount, matchOrder.id);

        // Update order status
        const newOrderFilled = newOrder.filled_amount + tradeAmount;
        if (newOrderFilled >= newOrder.amount_ax) {
          db.prepare('UPDATE marketplace_orders SET status = ? WHERE id = ?').run('filled', newOrderId);
        } else {
          db.prepare('UPDATE marketplace_orders SET status = ? WHERE id = ?').run('partial', newOrderId);
        }

        const matchOrderFilled = matchOrder.filled_amount + tradeAmount;
        if (matchOrderFilled >= matchOrder.amount_ax) {
          db.prepare('UPDATE marketplace_orders SET status = ? WHERE id = ?').run('filled', matchOrder.id);
        } else {
          db.prepare('UPDATE marketplace_orders SET status = ? WHERE id = ?').run('partial', matchOrder.id);
        }

        // Notify both users via WebSocket
        notifyOrderFilled(buyerId, { orderId: buyOrderId, amount: tradeAmount, price: tradePrice });
        notifyOrderFilled(sellerId, { orderId: sellOrderId, amount: tradeAmount, price: tradePrice });
      })();

      filled += tradeAmount;
    }
  } catch (err) {
    console.error('Match orders error:', err);
  }
}

// Cancel order
router.post('/cancel', authMiddleware, (req, res) => {
  try {
    const { orderId } = req.body;

    const order = db.prepare(`
      SELECT * FROM marketplace_orders WHERE id = ? AND user_id = ?
    `).get(orderId, req.userId);

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.status === 'filled') {
      return res.status(400).json({ error: 'Order already filled' });
    }

    // Refund locked balance for sell orders
    if (order.type === 'sell') {
      const remaining = order.amount_ax - order.filled_amount;
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?')
        .run(remaining, req.userId);
    }

    db.prepare('UPDATE marketplace_orders SET status = ? WHERE id = ?')
      .run('cancelled', orderId);

    res.json({ success: true, message: 'Order cancelled' });
  } catch (err) {
    console.error('Cancel order error:', err);
    res.status(500).json({ error: 'Failed to cancel order' });
  }
});

// Get user's orders
router.get('/my-orders', authMiddleware, (req, res) => {
  try {
    const orders = db.prepare(`
      SELECT * FROM marketplace_orders
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `).all(req.userId);

    res.json({ orders });
  } catch (err) {
    console.error('Get my orders error:', err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Get trade history
router.get('/trades', authMiddleware, (req, res) => {
  try {
    const trades = db.prepare(`
      SELECT t.*,
             bu.username as buyer_username,
             su.username as seller_username
      FROM trades t
      JOIN users bu ON t.buyer_id = bu.id
      JOIN users su ON t.seller_id = su.id
      WHERE t.buyer_id = ? OR t.seller_id = ?
      ORDER BY t.created_at DESC
      LIMIT 50
    `).all(req.userId, req.userId);

    res.json({ trades });
  } catch (err) {
    console.error('Get trades error:', err);
    res.status(500).json({ error: 'Failed to fetch trades' });
  }
});

module.exports = router;
