export function ErrorLine({ error }: { error?: string | null | undefined }) {
  if (!error) return null;
  return (
    <p role="alert" className="notice notice-danger">
      {error}
    </p>
  );
}
