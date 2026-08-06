/* ==========================================================================
   ARENAX FRONTEND - CHAT BOX COMPONENT
   In-game chat with emoji reactions
   ========================================================================== */

class ChatBox {
  constructor() {
    this.container = null;
    this.gameId = null;
    this.visible = false;
    this.minimized = true;
  }

  render() {
    if (!this.gameId) return '';

    const messages = store.getChatMessages(this.gameId);
    const user = store.getState().user;

    if (this.minimized) {
      return `
        <div class="chat-bubble" onclick="chatBox.toggleMinimize()">
          <span class="chat-icon">💬</span>
          ${messages.length > 0 ? `<span class="chat-badge">${messages.length}</span>` : ''}
        </div>
      `;
    }

    return `
      <div class="chat-box ${this.visible ? 'visible' : ''}">
        <div class="chat-header">
          <h4>Chat</h4>
          <div class="chat-controls">
            <button class="btn-icon" onclick="chatBox.toggleMinimize()">─</button>
            <button class="btn-icon" onclick="chatBox.close()">×</button>
          </div>
        </div>

        <div class="chat-messages" id="chat-messages-${this.gameId}">
          ${messages.length === 0 ? `
            <div class="empty-chat">
              <p>No messages yet</p>
              <p class="hint">Say hello! 👋</p>
            </div>
          ` : messages.map(msg => `
            <div class="chat-message ${msg.userId === user?.id ? 'own-message' : ''}">
              <div class="message-header">
                <span class="message-author">${this.escapeHtml(msg.username)}</span>
                <span class="message-time">${this.formatTime(msg.createdAt)}</span>
              </div>
              <div class="message-content">
                ${this.escapeHtml(msg.message)}
                ${msg.emojiReaction ? `<span class="emoji-reaction">${msg.emojiReaction}</span>` : ''}
              </div>
            </div>
          `).join('')}
        </div>

        <div class="chat-input">
          <input
            type="text"
            id="chat-input-${this.gameId}"
            placeholder="Type a message..."
            onkeypress="if(event.key === 'Enter') chatBox.sendMessage()"
            maxlength="200"
          >
          <button class="btn-emoji" onclick="chatBox.showEmojiPicker()">😀</button>
          <button class="btn-send" onclick="chatBox.sendMessage()">Send</button>
        </div>
      </div>
    `;
  }

  mount(containerId, gameId) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;

    this.gameId = gameId;
    this.visible = true;
    this.minimized = false;
    this.update();

    // Join game room
    socketClient.joinGame(gameId);

    // Load chat history
    this.loadHistory();

    // Subscribe to chat messages
    socketClient.on('chat_message', (data) => {
      if (data.gameId === this.gameId) {
        store.addChatMessage(this.gameId, data);
        this.update();
        this.scrollToBottom();
      }
    });

    store.subscribe(`chat.${gameId}`, () => {
      this.update();
      this.scrollToBottom();
    });
  }

  unmount() {
    if (this.gameId) {
      socketClient.leaveGame(this.gameId);
    }
    this.gameId = null;
    this.visible = false;
  }

  update() {
    if (!this.container) return;
    this.container.innerHTML = this.render();
  }

  toggleMinimize() {
    this.minimized = !this.minimized;
    this.update();
    if (!this.minimized) {
      this.scrollToBottom();
    }
  }

  close() {
    this.visible = false;
    this.unmount();
    this.update();
  }

  async loadHistory() {
    try {
      const response = await api.get(`/api/chat/${this.gameId}`);
      if (response.messages) {
        response.messages.forEach(msg => {
          store.addChatMessage(this.gameId, msg);
        });
      }
    } catch (err) {
      console.error('Load chat history error:', err);
    }
  }

  sendMessage() {
    const input = document.getElementById(`chat-input-${this.gameId}`);
    if (!input) return;

    const message = input.value.trim();
    if (!message) return;

    // Send via WebSocket
    socketClient.sendMessage(this.gameId, message);

    // Clear input
    input.value = '';
  }

  showEmojiPicker() {
    const emojis = ['😀', '😂', '😊', '😎', '🔥', '👍', '👏', '🎮', '🏆', '💰'];
    const emoji = prompt('Choose emoji:\n' + emojis.join(' '));

    if (emoji && emojis.includes(emoji)) {
      const input = document.getElementById(`chat-input-${this.gameId}`);
      if (input) {
        input.value += emoji;
        input.focus();
      }
    }
  }

  scrollToBottom() {
    setTimeout(() => {
      const messagesContainer = document.getElementById(`chat-messages-${this.gameId}`);
      if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
    }, 100);
  }

  formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

const chatBox = new ChatBox();
