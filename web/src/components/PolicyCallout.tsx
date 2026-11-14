interface Props {
  title: string;
  message: string;
  onJump?: () => void;
}

export function PolicyCallout({ title, message, onJump }: Props) {
  return (
    <div className="policy-callout" role="alert">
      <span className="policy-callout__diamond" aria-hidden />
      <div className="policy-callout__body">
        <p className="policy-callout__title">{title}</p>
        <p className="policy-callout__text">{message}</p>
      </div>
      {onJump && (
        <button type="button" className="policy-callout__link" onClick={onJump}>
          View
        </button>
      )}
    </div>
  );
}