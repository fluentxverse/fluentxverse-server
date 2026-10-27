import { onMount, onCleanup, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';

export interface AppDialogProps {
    children: JSX.Element;
    className?: string;
    label: string;
    onClose: () => void;
    busy?: boolean;
    dialogRef?: { current: HTMLDialogElement | null };
}

const locks = new WeakMap<Document, { count: number; overflow: string }>();

export default function AppDialog(props: AppDialogProps) {
    let dialog!: HTMLDialogElement;
    onMount(() => {
        const doc = dialog.ownerDocument;
        const opener = doc.activeElement as HTMLElement | null;
        const lock = locks.get(doc) || { count: 0, overflow: doc.body.style.overflow };
        if (lock.count++ === 0) doc.body.style.overflow = 'hidden';
        locks.set(doc, lock);
        try { dialog.showModal(); }
        catch (error) {
            if (--lock.count === 0) { doc.body.style.overflow = lock.overflow; locks.delete(doc); }
            throw error;
        }
        onCleanup(() => {
            dialog.close();
            if (--lock.count === 0) {
                doc.body.style.overflow = lock.overflow;
                locks.delete(doc);
            }
            if (props.dialogRef?.current === dialog) props.dialogRef.current = null;
            if (opener?.isConnected && !opener.closest('[inert]')) opener.focus({ preventScroll: true });
        });
    });
    return <Portal><dialog ref={element => {
        dialog = element;
        if (props.dialogRef) props.dialogRef.current = element;
    }} class={`fxv-dialog ${props.className || ''}`} aria-label={props.label} aria-busy={props.busy || false}
        onCancel={event => { event.preventDefault(); if (!props.busy) props.onClose(); }}
        onClick={event => {
            if (event.target !== dialog || props.busy) return;
            const box = dialog.getBoundingClientRect();
            if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)
                props.onClose();
        }}>{props.children}</dialog></Portal>;
}
