import { CircleAlert, Inbox, LoaderCircle, RotateCw } from 'lucide-solid';

export default function StatusPanel(props: {
    kind: 'loading' | 'error' | 'empty';
    title: string;
    message?: string;
    onRetry?: () => void;
    compact?: boolean;
}) {
    return <div class={`fxv-status${props.compact ? ' fxv-status--compact' : ''}`} role={props.kind === 'error' ? 'alert' : 'status'}>
        {props.kind === 'loading' ? <LoaderCircle class="fxv-spin" size={22}/> : props.kind === 'error' ? <CircleAlert size={22}/> : <Inbox size={22}/>}
        <div><strong>{props.title}</strong>{props.message && <p>{props.message}</p>}</div>
        {props.onRetry && <button type="button" class="fxv-button fxv-button--secondary" onClick={props.onRetry}><RotateCw size={16}/>Try again</button>}
    </div>;
}
