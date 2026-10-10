import { SignUp } from '@clerk/nextjs'

export default function SignUpPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#080b12] px-5 py-10 text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_16%,rgba(232,0,45,0.28),transparent_28%),radial-gradient(circle_at_84%_76%,rgba(53,88,180,0.24),transparent_32%)]" />
      <div className="auth-grid absolute inset-0 opacity-30" />
      <div className="auth-track absolute -bottom-24 left-1/2 h-[460px] w-[960px] -translate-x-1/2 rounded-[50%] border-[34px] border-slate-600/40" />
      <main className="relative z-10 grid w-full max-w-5xl items-center gap-12 lg:grid-cols-[1fr_auto]">
        <section className="hidden max-w-xl lg:block">
          <div className="mb-8 flex items-center gap-3 text-sm font-bold uppercase tracking-[0.22em] text-rose-400"><span className="h-2 w-2 rounded-full bg-rose-500 shadow-[0_0_14px_3px_rgba(232,0,45,0.65)]" />Pitwall AI</div>
          <h1 className="text-5xl font-semibold leading-[1.02] tracking-tight">Build your own<br /><span className="font-serif italic text-slate-300">race intelligence desk.</span></h1>
          <p className="mt-6 max-w-md text-base leading-7 text-slate-300">Create an account to keep your agent conversations and race analysis in one place.</p>
          <RaceCar />
        </section>
        <section className="w-full max-w-[400px] justify-self-center rounded-3xl border border-white/15 bg-white p-3 shadow-2xl shadow-black/40 backdrop-blur"><SignUp routing="path" path="/sign-up" signInUrl="/sign-in" /></section>
      </main>
    </div>
  )
}

function RaceCar() {
  return <div className="auth-car relative mt-14 h-20 w-72"><div className="absolute left-0 top-8 h-7 w-full rounded-[40%_58%_28%_25%] bg-gradient-to-r from-rose-700 via-red-500 to-rose-700 shadow-[0_12px_30px_rgba(232,0,45,0.38)]" /><div className="absolute left-20 top-2 h-8 w-28 rounded-t-[80%] bg-slate-200/80" /><div className="absolute left-7 top-12 h-10 w-10 rounded-full border-[8px] border-slate-950 bg-slate-500" /><div className="absolute right-7 top-12 h-10 w-10 rounded-full border-[8px] border-slate-950 bg-slate-500" /></div>
}
