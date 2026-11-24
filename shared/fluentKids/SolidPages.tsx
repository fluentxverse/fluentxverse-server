import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { FLUENT_KIDS_PATH, getFluentKidsLesson } from './curriculum';
import { fluentKidsRoadmap } from './roadmap';

export function FluentKidsLibrary(props: { legacyHref: string }) {
  onMount(() => { document.title = 'Fluent Kids | FluentXverse'; });
  return <main class="fk-course-page" innerHTML={fluentKidsRoadmap(FLUENT_KIDS_PATH, props.legacyHref)} />;
}

export function FluentKidsLesson(props: { id?: string; audience: 'student' | 'tutor' }) {
  let container!: HTMLDivElement;
  const [status, setStatus] = createSignal<'loading' | 'ready' | 'error'>('loading');
  createEffect(() => {
    const lesson = getFluentKidsLesson(props.id);
    if (!lesson) {
      document.title = 'Fluent Kids | FluentXverse';
      return;
    }
    document.title = `${lesson.title} | Fluent Kids`;
    let active = true;
    let dispose: (() => void) | undefined;
    setStatus('loading');
    const audience = props.audience;
    import('./lesson').then(({ mountFluentKidsLesson }) => {
      if (!active) return;
      dispose = mountFluentKidsLesson(container, lesson.id, { audience, courseHref: FLUENT_KIDS_PATH });
      setStatus('ready');
    }).catch(() => { if (active) setStatus('error'); });
    onCleanup(() => { active = false; dispose?.(); });
  });
  return <main class="fk-lesson-page">
    <Show when={getFluentKidsLesson(props.id)} fallback={<p>That lesson isn’t available yet. <a href={FLUENT_KIDS_PATH}>Fluent Kids roadmap</a></p>}>
      <div ref={container} />
      <Show when={status() !== 'ready'}>
        <p role="status">{status() === 'loading' ? 'Loading lesson…' : 'The lesson could not load. Refresh to try again.'}</p>
      </Show>
    </Show>
  </main>;
}
