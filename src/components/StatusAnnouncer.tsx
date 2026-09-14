interface StatusAnnouncerProps {
  message: string;
}

export function StatusAnnouncer({ message }: StatusAnnouncerProps) {
  return (
    <p className="sr-only" aria-live="polite" aria-atomic="true">
      {message}
    </p>
  );
}
