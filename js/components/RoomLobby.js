/* ==========================================================================
   ARENAX FRONTEND - ROOM LOBBY COMPONENT
   Custom room creation and joining for friend invites
   ========================================================================== */

class RoomLobby {
  constructor() {
    this.container = null;
  }

  render() {
    return `
      <div class="room-lobby">
        <div class="lobby-header">
          <h2>Custom Rooms</h2>
          <p class="subtitle">Play with friends</p>
        </div>

        <div class="lobby-content">
          <div class="create-room-section">
            <h3>Create Room</h3>
            <div class="room-form">
              <div class="form-row">
                <label>Game</label>
                <select id="room-game">
                  <option value="pool">8 Ball Pool</option>
                  <option value="carrom">Carrom</option>
                  <option value="ludo">Ludo</option>
                  <option value="chess">Chess</option>
                  <option value="checkers">Checkers</option>
                  <option value="snooker">Snooker</option>
                  <option value="glowhockey">Glow Hockey</option>
                  <option value="darts">Darts</option>
                  <option value="solitaire">Solitaire</option>
                </select>
              </div>

              <div class="form-row">
                <label>Wager (AX)</label>
                <input type="number" id="room-wager" min="0" value="0" placeholder="0 for friendly match">
              </div>

              <div class="form-row">
                <button class="btn-primary btn-full" onclick="roomLobby.createRoom()">Create Room</button>
              </div>
            </div>
          </div>

          <div class="join-room-section">
            <h3>Join Room</h3>
            <div class="room-form">
              <div class="form-row">
                <label>Room Code</label>
                <input type="text" id="room-code" placeholder="e.g. ABC123" maxlength="6">
              </div>

              <div class="form-row">
                <button class="btn-primary btn-full" onclick="roomLobby.joinRoom()">Join Room</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  mount(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;

    this.update();

    // Listen for game invites
    socketClient.on('game_invite', (data) => {
      const accept = confirm(`${data.fromUsername} invited you to play ${data.gameKey}!\n\nRoom Code: ${data.roomCode}\n\nJoin now?`);
      if (accept) {
        this.joinRoomByCode(data.roomCode);
      }
    });
  }

  update() {
    if (!this.container) return;
    this.container.innerHTML = this.render();
  }

  async createRoom() {
    const gameKey = document.getElementById('room-game')?.value;
    const wager = parseInt(document.getElementById('room-wager')?.value || 0);

    if (!gameKey) {
      arenaX.showNotification('Please select a game', 'error');
      return;
    }

    try {
      const response = await api.post('/api/rooms/create', { gameKey, wager });

      if (response.success && response.room) {
        const roomCode = response.room.room_code;
        arenaX.showNotification(`Room created! Code: ${roomCode}`, 'success');

        // Show share options
        const share = confirm(`Room Code: ${roomCode}\n\nCopy to clipboard?`);
        if (share) {
          navigator.clipboard.writeText(roomCode).then(() => {
            arenaX.showNotification('Room code copied!', 'success');
          });
        }

        // Show invite friend option
        setTimeout(() => {
          const invite = confirm('Invite a friend?');
          if (invite) {
            this.showInviteFriend(roomCode, gameKey);
          }
        }, 1000);
      }
    } catch (err) {
      arenaX.showNotification(err.message || 'Failed to create room', 'error');
    }
  }

  joinRoom() {
    const roomCode = document.getElementById('room-code')?.value?.trim().toUpperCase();
    if (!roomCode) {
      arenaX.showNotification('Please enter a room code', 'error');
      return;
    }

    this.joinRoomByCode(roomCode);
  }

  async joinRoomByCode(roomCode) {
    try {
      const response = await api.post('/api/rooms/join', { roomCode });

      if (response.success && response.room) {
        arenaX.showNotification('Joined room!', 'success');

        // Launch the game
        setTimeout(() => {
          arenaX.launchGame(response.room.game_key, 'pvp', response.room.wager);
        }, 500);
      }
    } catch (err) {
      arenaX.showNotification(err.message || 'Failed to join room', 'error');
    }
  }

  showInviteFriend(roomCode, gameKey) {
    const friends = store.getState().friends.filter(f => f.online);

    if (friends.length === 0) {
      arenaX.showNotification('No online friends to invite', 'info');
      return;
    }

    const friendsList = friends.map((f, i) => `${i + 1}. ${f.username} (#${f.id})`).join('\n');
    const choice = prompt(`Select friend to invite:\n\n${friendsList}\n\nEnter number:`);

    if (choice && !isNaN(choice)) {
      const index = parseInt(choice) - 1;
      if (friends[index]) {
        socketClient.sendGameInvite(friends[index].id, roomCode, gameKey);
        arenaX.showNotification(`Invite sent to ${friends[index].username}!`, 'success');
      }
    }
  }
}

const roomLobby = new RoomLobby();
