export default function SandboxCheckoutCancel() {
  return (
    <main className="mx-auto flex min-h-full w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-6 py-24">
      <p className="text-sm text-foreground/60">Tranche sandbox</p>
      <h1 className="text-3xl font-semibold tracking-tight">You left checkout</h1>
      <p className="text-lg text-foreground/80">
        Tell the test operator you stopped so they can check the order before another attempt.
      </p>
      <p className="text-foreground/70">
        This page does not confirm the payment or cancel the PayPal order.
      </p>
    </main>
  );
}
