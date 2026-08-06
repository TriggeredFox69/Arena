/* ==========================================================================
   ARENAX FRONTEND - STATE MANAGEMENT
   Simple pub-sub store for global app state
   ========================================================================== */

class Store {
  constructor() {
    this.state = {
      user: null,
      friends: [],
      friendRequests: [],
      marketplace: {
        buyOrders: [],
        sellOrders: [],
        myOrders: [],
        trades: []
      },
      chat: {},
      notifications: [],
      rooms: [],
      transfers: [],
      usdtTransactions: []
    };
    this.listeners = new Map();
  }

  getState() {
    return this.state;
  }

  setState(path, value) {
    // Support nested paths like 'user.balance'
    const keys = path.split('.');
    let current = this.state;

    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }

    current[keys[keys.length - 1]] = value;
    this.notify(path, value);
  }

  subscribe(path, callback) {
    if (!this.listeners.has(path)) {
      this.listeners.set(path, []);
    }
    this.listeners.get(path).push(callback);

    // Return unsubscribe function
    return () => {
      const callbacks = this.listeners.get(path);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    };
  }

  notify(path, value) {
    // Notify exact path listeners
    if (this.listeners.has(path)) {
      this.listeners.get(path).forEach(callback => {
        try {
          callback(value);
        } catch (err) {
          console.error(`[Store] Listener error for ${path}:`, err);
        }
      });
    }

    // Notify wildcard listeners
    if (this.listeners.has('*')) {
      this.listeners.get('*').forEach(callback => {
        try {
          callback(path, value);
        } catch (err) {
          console.error('[Store] Wildcard listener error:', err);
        }
      });
    }
  }

  // Helper methods
  setUser(user) {
    this.setState('user', user);
  }

  updateBalance(balance) {
    if (this.state.user) {
      this.state.user.balance = balance;
      this.notify('user.balance', balance);
      this.notify('user', this.state.user);
    }
  }

  setFriends(friends) {
    this.setState('friends', friends);
  }

  addFriend(friend) {
    this.state.friends.push(friend);
    this.notify('friends', this.state.friends);
  }

  removeFriend(friendId) {
    this.state.friends = this.state.friends.filter(f => f.id !== friendId);
    this.notify('friends', this.state.friends);
  }

  updateFriendStatus(friendId, online) {
    const friend = this.state.friends.find(f => f.id === friendId);
    if (friend) {
      friend.online = online;
      this.notify('friends', this.state.friends);
    }
  }

  setFriendRequests(requests) {
    this.setState('friendRequests', requests);
  }

  addFriendRequest(request) {
    this.state.friendRequests.push(request);
    this.notify('friendRequests', this.state.friendRequests);
  }

  removeFriendRequest(userId) {
    this.state.friendRequests = this.state.friendRequests.filter(r => r.id !== userId);
    this.notify('friendRequests', this.state.friendRequests);
  }

  setMarketplaceOrders(buyOrders, sellOrders) {
    this.state.marketplace.buyOrders = buyOrders;
    this.state.marketplace.sellOrders = sellOrders;
    this.notify('marketplace', this.state.marketplace);
  }

  addNotification(notification) {
    this.state.notifications.unshift({
      ...notification,
      id: Date.now(),
      read: false,
      timestamp: new Date().toISOString()
    });

    // Keep only last 50 notifications
    if (this.state.notifications.length > 50) {
      this.state.notifications = this.state.notifications.slice(0, 50);
    }

    this.notify('notifications', this.state.notifications);
  }

  markNotificationRead(id) {
    const notif = this.state.notifications.find(n => n.id === id);
    if (notif) {
      notif.read = true;
      this.notify('notifications', this.state.notifications);
    }
  }

  clearNotifications() {
    this.state.notifications = [];
    this.notify('notifications', []);
  }

  addChatMessage(gameId, message) {
    if (!this.state.chat[gameId]) {
      this.state.chat[gameId] = [];
    }
    this.state.chat[gameId].push(message);

    // Keep only last 100 messages per game
    if (this.state.chat[gameId].length > 100) {
      this.state.chat[gameId] = this.state.chat[gameId].slice(-100);
    }

    this.notify(`chat.${gameId}`, this.state.chat[gameId]);
    this.notify('chat', this.state.chat);
  }

  getChatMessages(gameId) {
    return this.state.chat[gameId] || [];
  }
}

// Global singleton
const store = new Store();
