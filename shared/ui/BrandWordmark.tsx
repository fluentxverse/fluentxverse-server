import './brand-wordmark.css';

export default function BrandWordmark(props: { inverse?: boolean; compact?: boolean }) {
  return (
    <span class="fxv-wordmark" classList={{ 'fxv-wordmark--inverse': props.inverse, 'fxv-wordmark--compact': props.compact }}>
      <span class="fxv-wordmark__text">Fluent<span class="fxv-wordmark__x">X</span>Verse</span>
    </span>
  );
}
