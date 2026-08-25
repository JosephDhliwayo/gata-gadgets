(function () {
  const btn = document.getElementById('enable-push-btn');
  if (!btn) return;

  const vapidPublicKey = btn.dataset.vapidKey;
  const alreadySubscribed = btn.dataset.subscribed === 'true';

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  function setState(text, disabled) {
    btn.textContent = text;
    btn.disabled = disabled;
  }

  async function enablePush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('Push not supported in this browser', true);
      return;
    }
    try {
      setState('Requesting permission...', true);
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState('Permission denied', true);
        return;
      }
      const registration = await navigator.serviceWorker.register('/sw.js');
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
      });
      await fetch('/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription)
      });
      setState('Login alerts enabled', true);
    } catch (err) {
      setState('Could not enable alerts', false);
    }
  }

  if (alreadySubscribed) {
    setState('Login alerts enabled', true);
  } else {
    btn.addEventListener('click', enablePush);
  }
})();
