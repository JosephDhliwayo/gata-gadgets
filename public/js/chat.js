(function () {
  const container = document.getElementById('chat-thread');
  const form = document.getElementById('chat-form');
  const textarea = document.getElementById('chat-body');
  if (!container || !form) return;

  const otherUserId = container.dataset.otherUserId;
  const currentUserId = container.dataset.currentUserId;

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function lastMessageId() {
    const bubbles = container.querySelectorAll('.chat-bubble');
    if (bubbles.length === 0) return 0;
    return parseInt(bubbles[bubbles.length - 1].dataset.id, 10) || 0;
  }

  function appendMessage(msg) {
    const isMine = msg.is_mine;
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble ' + (isMine ? 'mine' : 'theirs');
    bubble.dataset.id = msg.id;
    bubble.innerHTML = escapeHtml(msg.body) + '<span class="chat-meta">' + escapeHtml(msg.sender_name) + ' &middot; ' + escapeHtml(msg.created_at) + '</span>';
    container.appendChild(bubble);
  }

  async function poll() {
    try {
      const res = await fetch(`/chat/${otherUserId}/messages?after=${lastMessageId()}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.messages && data.messages.length) {
        data.messages.forEach(m => {
          m.is_mine = String(m.sender_id) === String(currentUserId);
          appendMessage(m);
        });
        container.scrollTop = container.scrollHeight;
      }
    } catch (e) { /* ignore transient network errors */ }
  }

  container.scrollTop = container.scrollHeight;
  setInterval(poll, 4000);

  form.addEventListener('submit', () => {
    setTimeout(() => { textarea.value = ''; }, 0);
  });
})();
