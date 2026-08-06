/* ==========================================================================
   ARENAX FRONTEND - SIDEBAR COMPONENT
   Friends list, online status, quick actions
   ========================================================================== */

class Sidebar {
  constructor() {
    this.container = null;
    this.visible = false;
  }

  render() {
    const friends = store.getState().friends;
    const friendRequests = store.getState().friendRequests;
    const user = store.getState().user;

    return `
      <div class="sidebar ${this.visible ? 'visible' : ''}" id="sidebar">
        <div class="sidebar-header">
          <h3>Friends</h3>
          <button class="sidebar-close" onclick="sidebar.toggle()">×</button>
        </div>

        ${friendRequests.length > 0 ? `
          <div class="friend-requests-section">
            <h4>Friend Requests (${friendRequests.length})</h4>
            ${friendRequests.map(req => `
              <div class="friend-request-item">
                <div class="friend-info">
                  <span class="friend-name">${this.escapeHtml(req.username)}</span>
                  <span class="friend-uid">#${req.id}</span>
                </div>
                <div class="friend-actions">
                  <button class="btn-accept" onclick="sidebar.acceptFriend(${req.id})">✓</button>
                  <button class="btn-decline" onclick="sidebar.declineFriend(${req.id})">×</button>
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <div class="friends-list">
          ${friends.length === 0 ? `
            <div class="empty-state">
              <p>No friends yet</p>
              <p class="hint">Add friends by their UID</p>
            </div>
          ` : friends.map(friend => `
            <div class="friend-item" data-friend-id="${friend.id}">
              <div class="friend-status ${friend.online ? 'online' : 'offline'}"></div>
              <div class="friend-info">
                <span class="friend-name">${this.escapeHtml(friend.username)}</span>
                <span class="friend-uid">#${friend.id}</span>
              </div>
              <div class="friend-actions">
                <button class="btn-icon" onclick="sidebar.inviteToGame(${friend.id}, '${this.escapeHtml(friend.username)}')" title="Invite to game">🎮</button>
                <button class="btn-icon" onclick="sidebar.sendTokens(${friend.id}, '${this.escapeHtml(friend.username)}')" title="Send tokens">💰</button>
              </div>
            </div>
          `).join('')}
        </div>

        <div class="sidebar-footer">
          <button class="btn-primary" onclick="sidebar.showAddFriend()">+ Add Friend</button>
        </div>
      </div>

      <button class="sidebar-toggle" onclick="sidebar.toggle()">
        <span class="toggle-icon">👥</span>
        ${friendRequests.length > 0 ? `<span class="badge">${friendRequests.length}</span>` : ''}
      </button>
    `;
  }

  mount(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    this.container = container;
    this.update();

    // Subscribe to state changes
    store.subscribe('friends', () => this.update());
    store.subscribe('friendRequests', () => this.update());

    // Listen to WebSocket events
    socketClient.on('user_online', (data) => {
      store.updateFriendStatus(data.userId, true);
    });

    socketClient.on('user_offline', (data) => {
      store.updateFriendStatus(data.userId, false);
    });

    socketClient.on('friend_request', (data) => {
      store.addFriendRequest({ id: data.fromUserId, username: data.fromUsername });
      store.addNotification({
        type: 'friend_request',
        title: 'Friend Request',
        message: `${data.fromUsername} sent you a friend request`
      });
    });

    socketClient.on('friend_accepted', (data) => {
      store.addNotification({
        type: 'friend_accepted',
        title: 'Friend Accepted',
        message: `${data.username} accepted your friend request`
      });
      this.loadFriends();
    });
  }

  update() {
    if (!this.container) return;
    this.container.innerHTML = this.render();
  }

  toggle() {
    this.visible = !this.visible;
    this.update();
  }

  async loadFriends() {
    try {
      const response = await api.get('/api/friends/list');
      if (response.friends) {
        // Mark all as offline initially, WebSocket will update online status
        const friendsWithStatus = response.friends.map(f => ({ ...f, online: false }));
        store.setFriends(friendsWithStatus);
      }
    } catch (err) {
      console.error('Load friends error:', err);
    }
  }

  async loadFriendRequests() {
    try {
      const response = await api.get('/api/friends/requests');
      if (response.requests) {
        store.setFriendRequests(response.requests);
      }
    } catch (err) {
      console.error('Load friend requests error:', err);
    }
  }

  showAddFriend() {
    const uid = prompt('Enter friend UID:');
    if (!uid) return;

    this.addFriend(parseInt(uid));
  }

  async addFriend(friendUid) {
    try {
      const response = await api.post('/api/friends/add', { friendUid });
      if (response.success) {
        arenaX.showNotification('Friend request sent!', 'success');
        socketClient.notifyFriendRequest(response.friend.id, response.friend.username);
      }
    } catch (err) {
      arenaX.showNotification(err.message || 'Failed to send friend request', 'error');
    }
  }

  async acceptFriend(friendId) {
    try {
      const response = await api.post('/api/friends/accept', { friendId });
      if (response.success) {
        arenaX.showNotification('Friend request accepted!', 'success');
        store.removeFriendRequest(friendId);
        socketClient.notifyFriendAccepted(friendId);
        await this.loadFriends();
      }
    } catch (err) {
      arenaX.showNotification(err.message || 'Failed to accept friend', 'error');
    }
  }

  async declineFriend(friendId) {
    try {
      const response = await api.post('/api/friends/decline', { friendId });
      if (response.success) {
        store.removeFriendRequest(friendId);
      }
    } catch (err) {
      arenaX.showNotification(err.message || 'Failed to decline friend', 'error');
    }
  }

  inviteToGame(friendId, friendUsername) {
    // Show game selection modal (to be implemented)
    arenaX.showNotification(`Invite ${friendUsername} to game (coming soon)`, 'info');
  }

  sendTokens(friendId, friendUsername) {
    const amount = prompt(`How many AX tokens to send to ${friendUsername}?`);
    if (!amount || isNaN(amount) || amount <= 0) return;

    const message = prompt('Add a message (optional):');
    this.transferTokens(friendId, parseInt(amount), message);
  }

  async transferTokens(toUserId, amount, message) {
    try {
      const response = await api.post('/api/transfers/send', {
        toUid: toUserId,
        amount,
        message
      });

      if (response.success) {
        arenaX.showNotification(`Sent ${amount} AX tokens!`, 'success');
        store.updateBalance(response.newBalance);
        socketClient.notifyTransfer(toUserId, amount, message);
      }
    } catch (err) {
      arenaX.showNotification(err.message || 'Failed to send tokens', 'error');
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

const sidebar = new Sidebar();
