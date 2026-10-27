import { ErrorBoundary, createSignal, createEffect, lazy, type Component } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { useLocation } from '@solidjs/router';
import { ArrowLeft, RotateCw } from 'lucide-solid';
import StatusPanel from './StatusPanel';

export function lazyRoute(load: () => Promise<{ default: Component<any> }>) {
    const initial = lazy(load);
    const RoutePage = (props: Record<string, unknown>) => {
        const location = useLocation();
        const [Page, setPage] = createSignal(initial);
        const Failure = (fallback: { reset: () => void }) => {
            const failedPath = location.pathname;
            const retry = () => { setPage(() => lazy(load)); fallback.reset(); };
            createEffect(() => { if (location.pathname !== failedPath) retry(); });
            return <section class="fxv-route-state" aria-label="Page unavailable">
                <StatusPanel kind="error" title="Could not open this page" message="Your session is unchanged. Try again when your connection is available."/>
                <div class="fxv-route-actions"><button type="button" class="fxv-button" onClick={retry}><RotateCw size={16}/>Try again</button>
                    <button type="button" class="fxv-button fxv-button--secondary" onClick={() => window.location.reload()}><RotateCw size={16}/>Reload latest version</button>
                    <a class="fxv-button fxv-button--secondary" href="/home"><ArrowLeft size={16}/>Go to Home</a></div>
            </section>;
        };
        return <ErrorBoundary fallback={(_error, reset) => <Failure reset={reset}/>}>
            <Dynamic component={Page()} {...props}/>
        </ErrorBoundary>;
    };
    return Object.assign(RoutePage, { preload: initial.preload });
}
