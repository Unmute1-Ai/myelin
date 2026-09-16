import { patient } from "../lib/mock";

export default function Home() {
  return (
    <main className="shell">
      <header className="topbar">
        <div><div className="brand">U1 <span>NeuroSignal</span></div><div className="sub">Clinician longitudinal review • Research prototype</div></div>
        <div className="status"><i /> Local-first</div>
      </header>

      <section className="hero">
        <div><p className="eyebrow">PATIENT {patient.id}</p><h1>Another signal.<br/>Not another authority.</h1><p>EEG + physiology + patient context, summarized against the person’s own baseline.</p></div>
        <div className="quality"><b>{patient.usableData}%</b><span>usable signal</span><small>{patient.baselineDays}-day baseline • synced {patient.lastSync}</small></div>
      </section>

      <section className="grid">
        {patient.metrics.map((m) => <article className="card" key={m.name}><span>{m.name}</span><strong>{m.value}</strong><b>{m.delta}</b><small>{m.detail}</small></article>)}
      </section>

      <section className="panel">
        <div><p className="eyebrow">REVIEW SUMMARY</p><h2>What changed</h2></div>
        <div className="observations">{patient.observations.map((o, i) => <p key={o}><span>0{i+1}</span>{o}</p>)}</div>
      </section>

      <section className="panel two">
        <div><p className="eyebrow">PATIENT CONTEXT</p><h2>Context stays beside the signal</h2><p className="muted">Patient-reported experience is never overwritten by inferred physiology.</p></div>
        <div className="context"><div><small>Sleep</small><b>5.8 h</b></div><div><small>Stress check-in</small><b>7 / 10</b></div><div><small>Medication change</small><b>None reported</b></div></div>
      </section>

      <footer>Not for diagnosis, treatment selection, emergency detection, or autonomous clinical action. Every summary must remain independently reviewable by a qualified professional.</footer>
    </main>
  );
}
