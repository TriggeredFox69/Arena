/* ==========================================================================
   ARENAX - MARKETPLACE ROUTES (Supabase / Netlify Functions)
   P2P exchange: order book, create/cancel orders, trade history.
   Matching occurs synchronously during order creation.
   ========================================================================== */

const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware);

function errorRes(res, message, status = 400) {
  return res.status(status).json({ success: false, error: message });
}

// GET /api/marketplace/orders — full order book
router.get('/orders', async (req, res) => {
  try {
    const { data: buyOrders, error: buyErr } = await supabaseAdmin
      .from('marketplace_orders')
      .select(`
        id, user_id, type, amount_ax, filled_amount, price_per_ax,
        total_value, status, created_at,
        users!marketplace_orders_user_id_fkey(username)
      `)
      .eq('type', 'buy')
      .in('status', ['open', 'partial'])
      .order('price_per_ax', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(50);

    if (buyErr) throw buyErr;

    const { data: sellOrders, error: sellErr } = await supabaseAdmin
      .from('marketplace_orders')
      .select(`
        id, user_id, type, amount_ax, filled_amount, price_per_ax,
        total_value, status, created_at,
        users!marketplace_orders_user_id_fkey(username)
      `)
      .eq('type', 'sell')
      .in('status', ['open', 'partial'])
      .order('price_per_ax', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(50);

    if (sellErr) throw sellErr;

    const format = (row) => ({
      id: row.id,
      userId: row.user_id,
      username: row.users?.username || 'Unknown',
      type: row.type,
      amountAx: row.amount_ax,
      filledAmount: row.filled_amount,
      pricePerAx: row.price_per_ax,
      totalValue: row.total_value,
      status: row.status,
      createdAt: row.created_at
    });

    return res.json({
      success: true,
      buyOrders: (buyOrders || []).map(format),
      sellOrders: (sellOrders || []).map(format)
    });
  } catch (err) {
    console.error('Get orders error:', err);
    return errorRes(res, 'Failed to fetch orders', 500);
  }
});

// GET /api/marketplace/my-orders — user's own orders
router.get('/my-orders', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('marketplace_orders')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    return res.json({ success: true, orders: data || [] });
  } catch (err) {
    console.error('My orders error:', err);
    return errorRes(res, 'Failed to fetch your orders', 500);
  }
});

// POST /api/marketplace/order — create a buy or sell order
router.post('/order', async (req, res) => {
  try {
    const { type, amountAx, pricePerAx } = req.body;

    if (!['buy', 'sell'].includes(type)) {
      return errorRes(res, 'Invalid order type. Must be "buy" or "sell".');
    }

    const amount = parseInt(amountAx);
    const price = parseInt(pricePerAx);

    if (!amount || amount <= 0) return errorRes(res, 'Amount must be positive');
    if (!price || price <= 0) return errorRes(res, 'Price must be positive');
    if (amount > 10000) return errorRes(res, 'Maximum order size is 10,000 AX');

    const totalValue = Math.round(amount * price);

    // For sell orders, lock the AX balance
    if (type === 'sell') {
      const { data: user, error: userErr } = await supabaseAdmin
        .from('users')
        .select('balance')
        .eq('id', req.userId)
        .single();

      if (userErr || !user) return errorRes(res, 'User not found', 404);
      if (user.balance < amount) return errorRes(res, 'Insufficient balance to place sell order');

      // Lock balance
      const { error: lockErr } = await supabaseAdmin
        .from('users')
        .update({ balance: user.balance - amount })
        .eq('id', req.userId);

      if (lockErr) throw lockErr;
    }

    // Insert the order
    const { data: order, error: insertErr } = await supabaseAdmin
      .from('marketplace_orders')
      .insert({
        user_id: req.userId,
        type,
        amount_ax: amount,
        filled_amount: 0,
        price_per_ax: price,
        total_value: totalValue,
        status: 'open'
      })
      .select('*')
      .single();

    if (insertErr) {
      // Refund locked balance on failure
      if (type === 'sell') {
        const { data: user } = await supabaseAdmin
          .from('users')
          .select('balance')
          .eq('id', req.userId)
          .single();
        if (user) {
          await supabaseAdmin
            .from('users')
            .update({ balance: user.balance + amount })
            .eq('id', req.userId);
        }
      }
      throw insertErr;
    }

    // Attempt to match against opposing orders
    let matched = false;
    try {
      const opposingType = type === 'buy' ? 'sell' : 'buy';
      const { data: candidates } = await supabaseAdmin
        .from('marketplace_orders')
        .select('*')
        .eq('type', opposingType)
        .in('status', ['open', 'partial'])
        .neq('user_id', req.userId)
        .order('price_per_ax', { ascending: opposingType === 'sell' }) // best price first
        .order('created_at', { ascending: true })
        .limit(10);

      if (candidates && candidates.length > 0) {
        for (const c of candidates) {
          if (order.status === 'filled') break;

          const priceMatch = type === 'buy'
            ? c.price_per_ax <= price  // we are buying, find sells at or below our price
            : c.price_per_ax >= price; // we are selling, find buys at or above our price

          if (!priceMatch) continue;

          const remainingOrder = order.amount_ax - (order.filled_amount || 0);
          const remainingCandidate = c.amount_ax - (c.filled_amount || 0);
          const fillAmount = Math.min(remainingOrder, remainingCandidate);
          const tradePrice = c.price_per_ax; // use the existing order's price
          const tradeValue = Math.round(fillAmount * tradePrice);

          if (fillAmount <= 0) continue;

          // Record the trade
          await supabaseAdmin.from('trades').insert({
            buy_order_id: type === 'buy' ? order.id : c.id,
            sell_order_id: type === 'sell' ? order.id : c.id,
            buyer_id: type === 'buy' ? req.userId : c.user_id,
            seller_id: type === 'sell' ? req.userId : c.user_id,
            amount_ax: fillAmount,
            price_per_ax: tradePrice,
            total_value: tradeValue
          });

          // Transfer AX from seller to buyer
          if (type === 'buy') {
            // Seller already had balance locked; transfer to buyer
            const { data: buyer } = await supabaseAdmin
              .from('users')
              .select('balance')
              .eq('id', req.userId)
              .single();
            if (buyer) {
              await supabaseAdmin
                .from('users')
                .update({ balance: buyer.balance + fillAmount })
                .eq('id', req.userId);
            }
            // Seller gets the value (their AX was already locked)
            const { data: seller } = await supabaseAdmin
              .from('users')
              .select('balance')
              .eq('id', c.user_id)
              .single();
            if (seller) {
              await supabaseAdmin
                .from('users')
                .update({ balance: seller.balance + tradeValue })
                .eq('id', c.user_id);
            }
          }

          // Update order fill amounts
          const newFilled = (order.filled_amount || 0) + fillAmount;
          const newStatus = newFilled >= order.amount_ax ? 'filled' : 'partial';
          await supabaseAdmin
            .from('marketplace_orders')
            .update({ filled_amount: newFilled, status: newStatus })
            .eq('id', order.id);

          const cNewFilled = (c.filled_amount || 0) + fillAmount;
          const cNewStatus = cNewFilled >= c.amount_ax ? 'filled' : 'partial';
          await supabaseAdmin
            .from('marketplace_orders')
            .update({ filled_amount: cNewFilled, status: cNewStatus })
            .eq('id', c.id);

          matched = true;
        }
      }
    } catch (matchErr) {
      console.warn('Order matching warning (non-fatal):', matchErr);
    }

    return res.json({
      success: true,
      message: matched ? 'Order placed and matched' : 'Order placed',
      order: {
        id: order.id,
        type: order.type,
        amountAx: order.amount_ax,
        pricePerAx: order.price_per_ax,
        totalValue: order.total_value,
        status: order.status,
        filledAmount: order.filled_amount
      }
    });
  } catch (err) {
    console.error('Create order error:', err);
    return errorRes(res, 'Failed to create order', 500);
  }
});

// POST /api/marketplace/:id/cancel — cancel an open order
router.post('/:id/cancel', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: order, error: findErr } = await supabaseAdmin
      .from('marketplace_orders')
      .select('*')
      .eq('id', id)
      .eq('user_id', req.userId)
      .single();

    if (findErr || !order) return errorRes(res, 'Order not found', 404);
    if (!['open', 'partial'].includes(order.status)) {
      return errorRes(res, 'Order is no longer open');
    }

    // Refund remaining balance for sell orders
    if (order.type === 'sell') {
      const remainingAmount = order.amount_ax - (order.filled_amount || 0);
      if (remainingAmount > 0) {
        const { data: user } = await supabaseAdmin
          .from('users')
          .select('balance')
          .eq('id', req.userId)
          .single();
        if (user) {
          await supabaseAdmin
            .from('users')
            .update({ balance: user.balance + remainingAmount })
            .eq('id', req.userId);
        }
      }
    }

    const { error } = await supabaseAdmin
      .from('marketplace_orders')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .eq('user_id', req.userId);

    if (error) throw error;

    return res.json({ success: true, message: 'Order cancelled' });
  } catch (err) {
    console.error('Cancel order error:', err);
    return errorRes(res, 'Failed to cancel order', 500);
  }
});

// GET /api/marketplace/trades — completed trades involving this user
router.get('/trades', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('trades')
      .select(`
        id, buy_order_id, sell_order_id, buyer_id, seller_id,
        amount_ax, price_per_ax, total_value, created_at,
        buyer:buyer_id(username),
        seller:seller_id(username)
      `)
      .or(`buyer_id.eq.${req.userId},seller_id.eq.${req.userId}`)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    const trades = (data || []).map(t => ({
      id: t.id,
      amountAx: t.amount_ax,
      pricePerAx: t.price_per_ax,
      totalValue: t.total_value,
      buyer: t.buyer?.username || 'Unknown',
      seller: t.seller?.username || 'Unknown',
      role: t.buyer_id === req.userId ? 'buyer' : 'seller',
      createdAt: t.created_at
    }));

    return res.json({ success: true, trades });
  } catch (err) {
    console.error('Trades error:', err);
    return errorRes(res, 'Failed to fetch trades', 500);
  }
});

module.exports = router;
