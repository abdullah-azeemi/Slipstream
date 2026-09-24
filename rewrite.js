const fs = require('fs');

let content = fs.readFileSync('apps/frontend/app/agent/page.tsx.backup', 'utf8');

const iconsToAdd = ['Search', 'Flame', 'ChevronDown', 'Download', 'Mic', 'Check', 'ArrowRight', 'Map'];
for (const icon of iconsToAdd) {
    if (!content.substring(0, content.indexOf('} from \'lucide-react\'')).includes(icon)) {
        content = content.replace('} from \'lucide-react\'', `  ${icon},\n} from 'lucide-react'`);
    }
}

const sidebarStart = content.indexOf('// ── Sidebar content (shared between desktop and mobile drawer) ──────────────');
const topPart = content.substring(0, sidebarStart);

const newUI = `// ── Sidebar content (shared between desktop and mobile drawer) ──────────────
  const SidebarContent = (
    <div className="flex h-full flex-col bg-white">
      {/* Top logo */}
      <div className="p-6 flex items-center gap-4 border-b border-slate-100">
        <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center text-white font-bold text-sm">S</div>
        <div>
          <div className="text-[13px] font-extrabold tracking-[0.1em] text-black flex items-center gap-2">
            SLIPSTREAM <span className="text-[8px] font-bold px-1.5 py-0.5 border border-slate-200 rounded text-slate-500">PRO</span>
          </div>
          <div className="text-[9px] text-slate-400 font-bold tracking-[0.15em] mt-0.5">TELEMETRY AGENT V2.4</div>
        </div>
      </div>

      <div className="px-5 pt-6 pb-4">
        <button className="w-full bg-[#1A1A1A] text-white rounded-lg flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-black transition-colors" onClick={newConversation}>
          <div className="flex items-center gap-2 text-xs font-semibold"><Plus className="w-4 h-4 text-rose-500" /> New Pit Wall Inquiry</div>
          <div className="text-[10px] text-slate-400 font-mono bg-white/10 px-1.5 py-0.5 rounded">⌘N</div>
        </button>
      </div>

      <div className="px-5 pb-6">
        <div className="relative">
          <input type="text" placeholder="Search telemetries & logs..." className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-600 placeholder-slate-400 focus:outline-none focus:border-rose-400" />
          <div className="absolute left-3 top-2.5"><Search className="w-4 h-4 text-slate-400" /></div>
          <div className="absolute right-3 top-2.5"><div className="text-[10px] text-slate-400 font-mono bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">⌘K</div></div>
        </div>
      </div>

      <div className="px-3 space-y-1">
        <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-rose-50/50 text-rose-600 font-semibold text-xs border border-rose-100/50">
          <div className="flex items-center gap-2"><Zap className="w-4 h-4" /> Live Strategy Orchestrator</div>
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
        </div>
        <div className="flex items-center gap-2 px-3 py-2.5 text-slate-500 font-medium text-xs hover:bg-slate-50 rounded-lg cursor-pointer">
          <History className="w-4 h-4 text-slate-400" /> Historical FIA Archive
        </div>
        <div className="flex items-center gap-2 px-3 py-2.5 text-slate-500 font-medium text-xs hover:bg-slate-50 rounded-lg cursor-pointer">
          <ShieldCheck className="w-4 h-4 text-slate-400" /> Deterministic Evidence Gate
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6 mt-2">
        <div className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-slate-400 mb-4">Today's Sessions</div>
        <div className="space-y-1 mb-8">
           <div className="text-xs text-black font-semibold px-2 py-1.5 bg-rose-50/50 border border-rose-100/50 rounded flex items-center gap-2 cursor-pointer"><div className="w-1.5 h-1.5 rounded-full bg-rose-500"></div> Sainz pit telemetry · Monaco 2026</div>
           <div className="text-xs font-medium text-slate-500 px-3 py-1.5 hover:text-black cursor-pointer">Hamilton vs Russell S2 delta</div>
           <div className="text-xs font-medium text-slate-500 px-3 py-1.5 hover:text-black cursor-pointer">Silverstone crossover lap 32 forecast</div>
        </div>
        
        <div className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-slate-400 mb-4">Yesterday</div>
        <div className="space-y-1 mb-8">
           <div className="text-xs font-medium text-slate-500 px-3 py-1.5 hover:text-black cursor-pointer">Leclerc apex speed comparison T3</div>
           <div className="text-xs font-medium text-slate-500 px-3 py-1.5 hover:text-black cursor-pointer">Red Bull front wing aero wake balance</div>
           <div className="text-xs font-medium text-slate-500 px-3 py-1.5 hover:text-black cursor-pointer">Verstappen pit stop stationary vs in-lap</div>
        </div>

        <div className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-slate-400 mb-4">Prior Grands Prix</div>
        <div className="space-y-1 mb-8">
           <div className="text-xs font-medium text-slate-500 px-3 py-1.5 hover:text-black cursor-pointer">Miami DRS train degradation model</div>
           <div className="text-xs font-medium text-slate-500 px-3 py-1.5 hover:text-black cursor-pointer">Spa-Francorchamps Eau Rouge vMin</div>
        </div>
      </div>

      <div className="p-5 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
         <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[#1A1A1A] flex items-center justify-center text-white text-[10px] font-bold">CS</div>
            <div>
               <div className="text-xs font-bold text-black">Chief Strategist</div>
               <div className="text-[10px] text-slate-400 font-mono mt-0.5">Telemetry Unit 01</div>
            </div>
         </div>
         <Radio className="w-4 h-4 text-slate-300" />
      </div>
    </div>
  )

  return (
    <div className="agent-page-root flex h-screen w-full bg-[#FDFDFD] text-slate-900 font-sans overflow-hidden">
      
      {/* ── Mobile sidebar drawer overlay ──────────── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm sm:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        className={\`fixed inset-y-0 left-0 z-50 w-72 flex-col border-r border-slate-200 bg-white shadow-xl transition-transform duration-300 sm:hidden \${
          sidebarOpen ? 'flex translate-x-0' : 'hidden -translate-x-full'
        }\`}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
           <div className="text-xs font-bold">Menu</div>
           <button onClick={() => setSidebarOpen(false)} className="p-1"><X className="w-4 h-4" /></button>
        </div>
        {SidebarContent}
      </aside>

      {/* ── Main 2-col layout ────────────────────────── */}
      
      {/* ── Left sidebar (desktop only) ───────────── */}
      <aside className="hidden sm:flex flex-col w-[280px] shrink-0 border-r border-slate-200 bg-white shadow-[10px_0_40px_rgba(0,0,0,0.02)] z-10">
        {SidebarContent}
      </aside>

      {/* ── Center panel (chat) ──────────── */}
      <section className="flex flex-col flex-1 bg-[#FAFAFA] min-w-0 h-full relative">
        
        {/* Topbar */}
        <div className="h-16 px-8 border-b border-slate-100 flex items-center justify-between bg-white shrink-0 absolute top-0 left-0 right-0 z-20">
           <div className="flex items-center gap-6">
              <button onClick={() => setSidebarOpen(true)} className="sm:hidden p-1 -ml-2"><Menu className="w-5 h-5 text-slate-500" /></button>
              <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.1em] text-black">
                 <div className="w-1.5 h-1.5 rounded-full bg-rose-500"></div>
                 STRATEGY_BOT // ACTIVE SESSION
              </div>
              <div className="w-px h-4 bg-slate-200 hidden sm:block"></div>
              <div className="text-xs text-slate-500 font-medium hidden sm:block">2026 Monaco Grand Prix</div>
           </div>
           <div className="flex items-center gap-3">
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-200 text-[11px] font-bold text-slate-600 bg-slate-50/50">
                 <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                 FIA Feed 12ms
              </div>
              <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 text-[11px] font-bold text-slate-600 bg-white shadow-sm">
                 <Database className="w-3.5 h-3.5 text-rose-500" />
                 Telemetry Hybrid Engine v2.4
                 <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-1" />
              </div>
              <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 text-[11px] font-bold text-slate-600 bg-white hover:bg-slate-50 shadow-sm transition-colors">
                 <Download className="w-3.5 h-3.5" />
                 <span className="hidden sm:inline">Export Stint Data</span>
              </button>
           </div>
        </div>

        {/* Scrollable Area */}
        <div className="flex-1 overflow-y-auto pt-16 pb-32 scroll-smooth" ref={chatScrollRef}>
            
            {/* Idle State */}
            {turns.length === 0 && !loadingQuestion && (
              <div className="flex flex-col items-center justify-center min-h-full p-8 max-w-4xl mx-auto w-full pt-20">
                 <div className="w-24 h-24 mb-10 rounded-full bg-rose-50/50 flex items-center justify-center relative">
                    <div className="absolute inset-0 rounded-full bg-rose-100/30 blur-xl"></div>
                    <div className="absolute inset-2 rounded-full border border-rose-200/50 shadow-[0_0_30px_rgba(244,63,94,0.2)]"></div>
                    <Flame className="w-8 h-8 text-rose-500 relative z-10" strokeWidth={1.5} />
                 </div>
                 
                 <h1 className="text-[44px] text-center mb-5 text-black tracking-tight leading-tight">
                    <span className="font-serif text-slate-700">Hello, </span>
                    <span className="font-serif italic text-slate-800">Chief Strategist</span>
                    <br />
                    <span className="font-medium text-slate-900">How can the pit wall assist you today?</span>
                 </h1>
                 
                 <p className="text-slate-500 text-center max-w-2xl mb-16 text-[13px] font-medium leading-relaxed">
                    Deterministic sensor calculations paired with multi-step reasoning. Real-time sector times,<br/>tyre degradation degradation vectors, and pit window models.
                 </p>
                 
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                    <div className="p-5 bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md hover:border-rose-200 transition-all cursor-pointer group" onClick={() => fillSuggestion("Compare Hard (C3) vs Medium (C4) wear degradation slopes for Ferrari past Lap 35 under green flag.")}>
                       <div className="flex items-center gap-2 mb-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-rose-500 group-hover:scale-125 transition-transform"></div>
                          <div className="text-[13px] font-bold text-slate-800">Synthesize Tyre Degradation</div>
                       </div>
                       <p className="text-[11px] text-slate-500 font-medium leading-relaxed pl-3.5">Compare Hard (C3) vs Medium (C4) wear degradation slopes for Ferrari past Lap 35 under green flag.</p>
                    </div>
                    
                    <div className="p-5 bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md hover:border-emerald-200 transition-all cursor-pointer group" onClick={() => fillSuggestion("Calculate minimum gap requirement for Sainz to jump Verstappen at Monaco Saint-Dévote.")}>
                       <div className="flex items-center gap-2 mb-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 group-hover:scale-125 transition-transform"></div>
                          <div className="text-[13px] font-bold text-slate-800">Pit Window Undercut Solver</div>
                       </div>
                       <p className="text-[11px] text-slate-500 font-medium leading-relaxed pl-3.5">Calculate minimum gap requirement for Sainz to jump Verstappen at Monaco Saint-Dévote.</p>
                    </div>
                    
                    <div className="p-5 bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md hover:border-amber-200 transition-all cursor-pointer group" onClick={() => fillSuggestion("Overlay Norris vs Leclerc minimum cornering speeds across Rascasse and the Swimming Pool chicane.")}>
                       <div className="flex items-center gap-2 mb-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-amber-500 group-hover:scale-125 transition-transform"></div>
                          <div className="text-[13px] font-bold text-slate-800">Apex Speed Delta Overlay</div>
                       </div>
                       <p className="text-[11px] text-slate-500 font-medium leading-relaxed pl-3.5">Overlay Norris vs Leclerc minimum cornering speeds across Rascasse and the Swimming Pool chicane.</p>
                    </div>
                    
                    <div className="p-5 bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md hover:border-blue-200 transition-all cursor-pointer group" onClick={() => fillSuggestion("Model 4°C track temperature drop impact on front-left graining threshold within 12 laps.")}>
                       <div className="flex items-center gap-2 mb-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 group-hover:scale-125 transition-transform"></div>
                          <div className="text-[13px] font-bold text-slate-800">Weather Radar Stint Impact</div>
                       </div>
                       <p className="text-[11px] text-slate-500 font-medium leading-relaxed pl-3.5">Model 4°C track temperature drop impact on front-left graining threshold within 12 laps.</p>
                    </div>
                 </div>
              </div>
            )}

            {/* Active Stream Divider */}
            {turns.length > 0 && (
              <div className="max-w-4xl mx-auto px-8 py-10 flex items-center justify-center gap-4">
                 <div className="h-px bg-slate-200 flex-1"></div>
                 <div className="text-[9px] font-extrabold uppercase tracking-[0.2em] text-slate-400">Active Stream</div>
                 <div className="h-px bg-slate-200 flex-1"></div>
              </div>
            )}

            {/* Chat Turns */}
            <div className="max-w-4xl mx-auto px-6 sm:px-8 space-y-12 pb-10">
              {turns.map((turn) => (
                <div key={turn.id} className="flex flex-col gap-6">
                  
                  {/* User bubble */}
                  <div className="flex justify-end">
                    <div className="max-w-[85%] border border-slate-200 bg-white rounded-2xl rounded-tr-sm px-6 py-5 shadow-sm flex flex-col gap-3">
                      <div className="flex justify-between items-center text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">
                        <span>CHIEF_STRATEGIST · {new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}</span>
                      </div>
                      <p className="text-[14px] font-medium leading-relaxed text-slate-800">{turn.question}</p>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-[#1A1A1A] text-white flex items-center justify-center text-[10px] font-bold shrink-0 ml-4 mt-2">CS</div>
                  </div>

                  {/* Agent Response */}
                  {(turn.nodes.length > 0 || turn.reply) && (
                    <div className="flex gap-4 w-full">
                       <div className="w-8 h-8 rounded-lg bg-rose-600 text-white flex items-center justify-center shrink-0 mt-1 shadow-md shadow-rose-500/20">
                          <Zap className="w-4 h-4" />
                       </div>
                       
                       <div className="flex-1 flex flex-col gap-4">
                          
                          {/* DAG Pills */}
                          {turn.nodes.length > 0 && (
                            <div className="w-full">
                               <div className="flex justify-between items-center mb-2 px-1">
                                  <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-rose-500 flex items-center gap-2">
                                     STRATEGY_DAG // EXECUTION CHAIN 
                                     <span className="text-slate-400 font-sans tracking-normal font-medium">{turn.nodes.length} / {turn.nodes.length} nodes deterministic</span>
                                  </div>
                                  <div className="text-[10px] font-medium text-slate-400 cursor-pointer hover:text-slate-600 flex items-center gap-1">
                                     Inspect Neural Logs <ChevronDown className="w-3 h-3" />
                                  </div>
                               </div>
                               
                               <div className="flex items-center gap-2 overflow-x-auto pb-2 flex-wrap">
                                  {turn.nodes.map((n, i) => {
                                     const isLast = i === turn.nodes.length - 1;
                                     const isDone = turn.nodeStates[n.id]?.state === 'done';
                                     
                                     if (isLast) {
                                        return (
                                           <React.Fragment key={n.id}>
                                              {i > 0 && <ArrowRight className="w-3 h-3 text-slate-300 mx-0.5" />}
                                              <div className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 border border-rose-200 bg-rose-50 text-rose-600 rounded-lg text-xs font-semibold shadow-sm">
                                                 <div className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></div> {n.tool_name.replace(/_/g, ' ')}
                                              </div>
                                           </React.Fragment>
                                        )
                                     }
                                     return (
                                        <React.Fragment key={n.id}>
                                           <div className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 border border-emerald-200 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-semibold">
                                              <Check className="w-3.5 h-3.5" strokeWidth={3} /> {n.tool_name.replace(/_/g, ' ')}
                                           </div>
                                           <ArrowRight className="w-3 h-3 text-slate-300 mx-0.5" />
                                        </React.Fragment>
                                     )
                                  })}
                               </div>
                            </div>
                          )}

                          {/* Final Answer Text */}
                          {turn.reply && (
                            <div className="pitwall-prose bg-white rounded-2xl p-6 border border-slate-100 shadow-sm text-[15px] leading-relaxed text-slate-700">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.reply.answer}</ReactMarkdown>
                            </div>
                          )}
                          
                       </div>
                    </div>
                  )}

                </div>
              ))}
              
              {loadingQuestion && !turns.find(t => t.question === loadingQuestion)?.reply && (
                <div className="flex justify-end opacity-60">
                   <div className="max-w-[85%] border border-slate-200 bg-white rounded-2xl rounded-tr-sm px-6 py-4 flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-rose-500 animate-bounce"></div>
                      <div className="w-2 h-2 rounded-full bg-rose-500 animate-bounce delay-75"></div>
                      <div className="w-2 h-2 rounded-full bg-rose-500 animate-bounce delay-150"></div>
                   </div>
                   <div className="w-8 h-8 rounded-full bg-[#1A1A1A] text-white flex items-center justify-center text-[10px] font-bold shrink-0 ml-4">CS</div>
                </div>
              )}
            </div>
            
        </div>
        
        {/* Floating Input area */}
        <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[#FAFAFA] via-[#FAFAFA]/90 to-transparent pointer-events-none">
          <form
            onSubmit={ask}
            className="mx-auto max-w-3xl relative bg-white border border-slate-200 rounded-2xl shadow-[0_8px_40px_rgb(0,0,0,0.08)] p-3 flex flex-col gap-3 pointer-events-auto transition-shadow hover:shadow-[0_8px_40px_rgb(0,0,0,0.12)]"
          >
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="In British GP 2024, when did Carlos pit?"
              className="w-full text-[15px] font-medium bg-transparent border-none px-3 pt-2 pb-1 focus:ring-0 focus:outline-none placeholder-slate-400 text-slate-800"
            />
            <div className="flex items-center justify-between px-2">
               <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 text-slate-500 rounded-md flex shrink-0 text-[11px] font-bold border border-slate-100">
                     <Database className="w-3 h-3 text-rose-500" /> Telemetry Ingestion
                  </div>
                  <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 text-slate-500 rounded-md shrink-0 text-[11px] font-bold border border-slate-100">
                     <Map className="w-3 h-3 text-slate-400" /> Silverstone Circuit
                  </div>
                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-rose-50 text-rose-600 border border-rose-100 rounded-md shrink-0 text-[11px] font-bold">
                     Multi-Stint Delta
                  </div>
               </div>
               <div className="flex items-center gap-3 shrink-0 ml-4">
                  <Mic className="w-5 h-5 text-slate-300 cursor-pointer hover:text-slate-600 transition-colors" />
                  <button type="submit" disabled={!question.trim() || loadingQuestion} className="w-10 h-10 rounded-full bg-rose-600 flex items-center justify-center text-white hover:bg-rose-500 transition-all disabled:opacity-50 disabled:hover:bg-rose-600 shadow-md shadow-rose-500/20">
                     {loadingQuestion ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 ml-0.5" />}
                  </button>
               </div>
            </div>
          </form>
          <div className="text-center mt-4 mb-2 text-[9px] text-slate-400 font-mono tracking-widest uppercase">
             Slipstream Neural Kernel 2.4. Telemetry verified via FIA Technical Regulation Appx L.
          </div>
        </div>
      </section>
    </div>
  )
}
`

fs.writeFileSync('apps/frontend/app/agent/page.tsx', topPart + newUI);
console.log('Successfully applied new UI');
