import { Toaster as Sonner, toast } from 'sonner';

export { toast };

/** Bottom-right toasts in the Ledger tokens. */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      duration={2600}
      gap={8}
      offset={20}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: 'toast',
          title: 'toast-title',
          description: 'toast-desc',
          success: 'toast-ok',
          error: 'toast-err',
          warning: 'toast-warn',
        },
      }}
    />
  );
}
