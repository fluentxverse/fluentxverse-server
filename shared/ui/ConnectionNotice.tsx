import { createSignal, onMount, onCleanup } from 'solid-js';
import { Wifi, WifiOff, X } from 'lucide-solid';

export default function ConnectionNotice() {
    const [offline, setOffline] = createSignal(!navigator.onLine);
    const [reconnected, setReconnected] = createSignal(false);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    onMount(() => {
        const lost = () => { clearTimeout(timeout); setReconnected(false); setOffline(true); };
        const restored = () => {
            if (!offline()) return;
            setOffline(false); setReconnected(true);
            clearTimeout(timeout);
            timeout = setTimeout(() => setReconnected(false), 5000);
        };
        window.addEventListener('offline', lost);
        window.addEventListener('online', restored);
        onCleanup(() => {
            window.removeEventListener('offline', lost);
            window.removeEventListener('online', restored);
            clearTimeout(timeout);
        });
    });
    return <>{(offline() || reconnected()) && <aside class={`fxv-connection ${offline() ? 'is-offline' : 'is-online'}`} role="status" aria-live="polite">
        {offline() ? <WifiOff size={18}/> : <Wifi size={18}/>}
        <span>{offline() ? 'You are offline. Changes cannot be submitted until your connection returns.' : 'Connection restored. You can try again.'}</span>
        {!offline() && <button type="button" title="Dismiss connection notice" aria-label="Dismiss connection notice" onClick={() => setReconnected(false)}><X size={18}/></button>}
    </aside>}</>;
}
