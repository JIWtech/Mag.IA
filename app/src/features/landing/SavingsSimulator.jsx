import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Pause, RotateCcw } from 'lucide-react';
import {
  computeSavings,
  DEMO_SCENARIOS,
  maxManualMonthly,
  SAVINGS_ASSUMPTIONS,
  SLIDER_LIMITS,
} from './savingsModel.js';
import { useInView, usePrefersReducedMotion, useTweenedNumber } from './useLandingMotion.js';

const TWEEN_MS = 1500;
const HOLD_MS = 2600;

const formatBRL = (value) =>
  Math.round(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

const formatMultiplier = (value) => value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

const snap = (value, step) => Math.round(value / step) * step;

const COMPARISON = [
  { topic: 'Tempo de resposta', today: '15 a 45 minutos', noria: '3 segundos' },
  { topic: 'Cobertura', today: 'Sem atendimento à noite e nos finais de semana', noria: '24 horas por dia' },
  { topic: 'Follow-up', today: 'Leads e orçamentos esquecidos', noria: 'Follow-ups programados no Kanban' },
  { topic: 'Qualificação', today: 'Vendedores perdem tempo com curiosos', noria: 'IA coleta nome, interesse e entrada' },
];

function Slider({ id, label, display, value, limits, onUserInput }) {
  const fill = ((value - limits.min) / (limits.max - limits.min)) * 100;
  return (
    <div className="sim-control">
      <label htmlFor={id}>
        <span>{label}</span>
        <strong className="lp-mono">{display}</strong>
      </label>
      <input
        id={id}
        type="range"
        min={limits.min}
        max={limits.max}
        step={limits.step}
        value={value}
        className="sim-slider"
        style={{ '--fill': `${fill}%` }}
        onPointerDown={() => onUserInput(null)}
        onKeyDown={() => onUserInput(null)}
        onChange={(event) => onUserInput(Number(event.target.value))}
      />
    </div>
  );
}

export function SavingsSimulator({ onStart }) {
  const rootRef = useRef(null);
  const inView = useInView(rootRef, { threshold: 0.35 });
  const reducedMotion = usePrefersReducedMotion();

  const [inputs, setInputs] = useState(DEMO_SCENARIOS[0]);
  const [demoActive, setDemoActive] = useState(true);
  const [scenarioIndex, setScenarioIndex] = useState(0);

  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;
  const scenarioRef = useRef(0);
  // Bloqueio síncrono: um frame já agendado da demonstração nunca sobrescreve o visitante.
  const userControlRef = useRef(false);

  const demoRunning = demoActive && inView && !reducedMotion;

  useEffect(() => {
    if (!demoRunning) return undefined;
    let cancelled = false;
    let frame = 0;
    let timer = 0;

    const goTo = (index) => {
      const from = inputsRef.current;
      const to = DEMO_SCENARIOS[index];
      const startedAt = performance.now();
      const tick = (now) => {
        if (cancelled || userControlRef.current) return;
        const t = Math.min(1, (now - startedAt) / TWEEN_MS);
        const eased = easeInOut(t);
        const next = {
          attendants: Math.round(from.attendants + (to.attendants - from.attendants) * eased),
          salary: snap(from.salary + (to.salary - from.salary) * eased, SLIDER_LIMITS.salary.step),
        };
        const current = inputsRef.current;
        if (next.attendants !== current.attendants || next.salary !== current.salary) setInputs(next);
        if (t < 1) {
          frame = requestAnimationFrame(tick);
        } else {
          scenarioRef.current = index;
          setScenarioIndex(index);
          timer = window.setTimeout(() => goTo((index + 1) % DEMO_SCENARIOS.length), HOLD_MS);
        }
      };
      frame = requestAnimationFrame(tick);
    };

    // Retoma do cenário atual: segura nele antes de avançar.
    timer = window.setTimeout(() => goTo((scenarioRef.current + 1) % DEMO_SCENARIOS.length), HOLD_MS);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [demoRunning]);

  const takeControl = useCallback((field, value) => {
    userControlRef.current = true;
    setDemoActive(false);
    if (value !== null) setInputs((prev) => ({ ...prev, [field]: value }));
  }, []);

  const restartDemo = () => {
    userControlRef.current = false;
    scenarioRef.current = 0;
    setScenarioIndex(0);
    setInputs(DEMO_SCENARIOS[0]);
    setDemoActive(true);
  };

  const result = computeSavings(inputs);
  const scaleMax = maxManualMonthly();
  const tweenOptions = { duration: 450, disabled: reducedMotion };
  const manualMonthly = useTweenedNumber(result.manualMonthly, tweenOptions);
  const manualYearly = useTweenedNumber(result.manualYearly, tweenOptions);
  const savingsMonthly = useTweenedNumber(result.savingsMonthly, tweenOptions);
  const savingsYearly = useTweenedNumber(result.savingsYearly, tweenOptions);
  const withNoriaMonthly = useTweenedNumber(result.withNoriaMonthly, tweenOptions);

  // Comprimento total em escala de raiz (equipes pequenas continuam visíveis);
  // a divisão "Com NORIA" é linear sobre o mesmo comprimento, então as duas
  // barras permanecem proporcionais entre si.
  const totalWidth = Math.sqrt(Math.min(1, manualMonthly / scaleMax)) * 100;
  const share = (value) => (manualMonthly > 0 ? value / manualMonthly : 0);
  const pct = (value) => `${(totalWidth * share(value)).toFixed(2)}%`;

  let status;
  if (reducedMotion) status = 'Ajuste os valores para simular a sua operação';
  else if (demoActive) status = `Demonstração automática · cenário ${scenarioIndex + 1} de ${DEMO_SCENARIOS.length}`;
  else status = 'Você está no controle da simulação';

  return (
    <div className={`sim ${demoRunning ? 'is-demo' : ''}`} ref={rootRef}>
      <div className="sim-status">
        <span className="sim-status-label">
          <span className="sim-status-dot" aria-hidden="true" />
          Simulação interativa
          <span className="sim-status-sep" aria-hidden="true">/</span>
          <span aria-live="polite">{status}</span>
        </span>
        {!reducedMotion && (
          demoActive ? (
            <button type="button" className="sim-status-btn" onClick={() => takeControl('attendants', null)}>
              <Pause size={13} /> Pausar
            </button>
          ) : (
            <button type="button" className="sim-status-btn" onClick={restartDemo}>
              <RotateCcw size={13} /> Reiniciar demonstração
            </button>
          )
        )}
      </div>

      <div className="sim-grid">
        <div className="sim-area sim-area--params">
          <span className="sim-step"><b>1</b> Sua equipe hoje</span>
          <Slider
            id="attendant-range"
            label="Pessoas respondendo o WhatsApp"
            display={`${result.attendants} ${result.attendants === 1 ? 'pessoa' : 'pessoas'}`}
            value={inputs.attendants}
            limits={SLIDER_LIMITS.attendants}
            onUserInput={(value) => takeControl('attendants', value)}
          />
          <Slider
            id="salary-range"
            label="Salário bruto médio"
            display={formatBRL(result.salary)}
            value={inputs.salary}
            limits={SLIDER_LIMITS.salary}
            onUserInput={(value) => takeControl('salary', value)}
          />
          <p className="sim-hours">
            <strong className="lp-mono">{Math.round(result.repetitiveHoursPerDay)} h/dia</strong>
            da equipe respondendo dúvidas repetidas que a IA responderia em segundos.
          </p>
        </div>

        <div className="sim-area sim-area--current">
          <span className="sim-step"><b>2</b> Atendimento tradicional</span>
          <p className="sim-figure sim-figure--current">
            {formatBRL(manualMonthly)}<small>/mês</small>
          </p>
          <p className="sim-sub">{formatBRL(manualYearly)} por ano</p>
          <p className="sim-detail">
            {formatBRL(result.costPerAttendant)} por atendente: salário × {formatMultiplier(SAVINGS_ASSUMPTIONS.laborCostMultiplier)} de
            encargos, benefícios e infraestrutura.
          </p>
        </div>

        <div className="sim-area sim-area--noria">
          <span className="sim-step"><b>3</b> Economia estimada com a NORIA</span>
          <p className="sim-figure sim-figure--savings">
            {formatBRL(savingsMonthly)}<small>/mês</small>
          </p>
          <p className="sim-sub sim-sub--positive">até {formatBRL(savingsYearly)} por ano</p>
          <button className="lp-btn lp-btn--primary lp-btn--lg sim-cta" type="button" onClick={onStart}>
            Quero economizar {formatBRL(result.savingsMonthly)}/mês <ArrowRight size={17} />
          </button>
        </div>

        <div className="sim-bars" aria-hidden="true">
          <div className="sim-bar-row">
            <span className="sim-bar-label">Hoje</span>
            <div className="sim-bar-track">
              <span className="sim-bar sim-bar--current" style={{ width: pct(manualMonthly) }} />
            </div>
            <span className="sim-bar-value lp-mono">{formatBRL(manualMonthly)}</span>
          </div>
          <div className="sim-bar-row">
            <span className="sim-bar-label">Com NORIA</span>
            <div className="sim-bar-track">
              <span className="sim-bar sim-bar--noria" style={{ width: pct(withNoriaMonthly) }} />
              <span className="sim-bar sim-bar--saved" style={{ width: pct(savingsMonthly) }} />
            </div>
            <span className="sim-bar-value lp-mono">{formatBRL(withNoriaMonthly)}</span>
          </div>
        </div>
      </div>

      <dl className="sim-compare">
        <div className="sim-compare-head" aria-hidden="true">
          <span />
          <span>Hoje</span>
          <span>Com NORIA</span>
        </div>
        {COMPARISON.map((row) => (
          <div className="sim-compare-row" key={row.topic}>
            <dt>{row.topic}</dt>
            <dd className="sim-compare-today">{row.today}</dd>
            <dd className="sim-compare-noria">{row.noria}</dd>
          </div>
        ))}
      </dl>

      <p className="sim-assumptions">
        Premissas da simulação: custo por atendente igual ao salário × {formatMultiplier(SAVINGS_ASSUMPTIONS.laborCostMultiplier)};
        a IA assume {Math.round(SAVINGS_ASSUMPTIONS.automatableShare * 100)}% do atendimento repetitivo;
        {' '}{formatMultiplier(SAVINGS_ASSUMPTIONS.repetitiveHoursPerAttendant)} h/dia de perguntas repetidas por atendente.
        {result.includesNoriaCost
          ? ` Inclui o custo da NORIA de ${formatBRL(result.noriaMonthly)}/mês.`
          : ' Valor da assinatura NORIA não incluído.'}
        {' '}Os cenários automáticos são exemplos; o resultado depende das características de cada operação.
      </p>
    </div>
  );
}

export default SavingsSimulator;
