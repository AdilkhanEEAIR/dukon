// Иконки товаров: свои рисованные «наклейки» по категориям (газировка, вода, молоко, хлеб, чипсы…).
// Логотипы брендов не рисуем — бренд в названии лишь подсказывает категорию: «Coca-Cola 1 л» → бутылка газировки.
// Категория определяется по словам в названии на русском, кыргызском и английском; не узнали — коробка.

import type { CSSProperties, ReactNode } from 'react'

export type ProductKind =
  | 'cola'
  | 'orangeSoda'
  | 'lemonSoda'
  | 'water'
  | 'energy'
  | 'beer'
  | 'juice'
  | 'milk'
  | 'kefir'
  | 'yogurt'
  | 'butter'
  | 'oil'
  | 'bread'
  | 'chips'
  | 'gum'
  | 'chocolate'
  | 'candy'
  | 'cookies'
  | 'corn'
  | 'canned'
  | 'tea'
  | 'coffee'
  | 'eggs'
  | 'noodles'
  | 'grain'
  | 'cheese'
  | 'sausage'
  | 'icecream'
  | 'household'
  | 'box'

// Граница слова для кириллицы: \b в JS понимает только латиницу, поэтому — через свойства Unicode.
const W = (s: string) => `(?<!\\p{L})(?:${s})(?!\\p{L})`

// Порядок важен: первое совпадение побеждает. «Масло сливочное» раньше «масла» вообще, энергетики раньше газировки.
const RULES: [ProductKind, RegExp][] = (
  [
    ['butter', `сливочн|butter|спред|маргарин|сары\\s?май`],
    ['oil', `подсолн|растител|оливк|${W('oil')}|масло[^\\d]*\\d+([.,]\\d+)?\\s?л${'(?!\\p{L})'}|өсүмдүк`],
    ['butter', `${W('масло')}|${W('май')}`],
    ['energy', `red\\s?bull|adrenalin|адреналин|${W('flash')}|флэш|energy|энерг|gorilla|горилла|monster|${W('burn')}`],
    ['beer', `пиво|${W('beer')}|lager|лагер|балтик|${W('арпа|arpa')}|жигул`],
    // «кола» сидит внутри «шоколада» и «chocolate» — поэтому только отдельным словом.
    ['cola', `${W('cola|кола')}|coca-?cola|кока-?кола|pepsi|пепси`],
    ['orangeSoda', `fanta|фанта|mirinda|миринда|orange\\s?soda`],
    ['lemonSoda', `sprite|спрайт|7\\s?up|лимонад|тархун|tarhun|schweppes|швепс|газиров|${W('soda|сода')}`],
    ['water', `вода|воды|water|${W('суу')}|bonaqua|бонаква|${W('aqua|аква')}|легенда|арчалы|минерал`],
    ['juice', `${W('сок|сока|соки')}|juice|нектар|nectar|компот|${W('морс')}|piko|пико|gracio|грацио`],
    // «Milk chocolate» — шоколад, а не молоко: шоколад проверяем раньше молочки.
    ['chocolate', `шокол|chocolate|snickers|сникерс|${W('mars|марс')}|twix|твикс|bounty|баунти|kit\\s?kat|kinder|киндер|milka|милка|alpen|альпен|picnic|пикник|аленк|алёнк`],
    ['kefir', `кефир|kefir|айран|ayran|ряженк|${W('тан')}|чалап|снежок|ацидоф`],
    ['yogurt', `йогурт|yogh?urt|творож|сметан|danone|данон|активиа|activia`],
    ['milk', `молок|milk|${W('сүт|сут')}`],
    ['icecream', `морожен|ice\\s?cream|пломбир|эскимо|балмуздак`],
    ['cheese', `${W('сыр|сыра|сыры|сырок')}|cheese|брынз|моцарел`],
    ['sausage', `колбас|сосиск|sausage|сардел|ветчин|${W('ham')}|хот-?дог`],
    ['eggs', `${W('яйца|яйцо|яиц')}|${W('eggs?')}|жумуртка`],
    ['bread', `хлеб|bread|${W('нан')}|лепеш|батон|булк|багет|${W('toast|тост')}|лаваш|lavash|самса`],
    ['chips', `chips|чипс|cheetos|читос|lay'?s|лейс|pringles|принглс|doritos|кириешк|сухарик|попкорн|popcorn|снек`],
    ['gum', `orbit|орбит|dirol|дирол|eclipse|жвач|${W('gum')}|mentos|ментос|stimorol`],
    ['candy', `конфет|candy|карамел|чупа|chupa|мармелад|skittles|скитлс|m&m|${W('ирис')}|леденц`],
    ['cookies', `печень|cookie|biscuit|бисквит|вафл|wafer|крекер|cracker|пряник|oreo|орео|юбилейн`],
    ['noodles', `доширак|лапш|роллтон|rollton|noodle|бигбон|big\\s?bon|макарон|pasta|${W('паста')}|спагет|рожки|вермишел`],
    ['corn', `кукуруз|${W('corn')}|горош|${W('peas')}`],
    ['canned', `консерв|тушен|фасол|шпрот|сайр|тунец|tuna|beans|паштет`],
    ['tea', `${W('чай|чая')}|${W('tea')}|ахмад|ahmad|greenfield|гринфилд|пиала`],
    ['coffee', `кофе|coffee|nescaf|нескаф|jacobs|якобс|maccoffee|маккофе|3\\s?в\\s?1|3\\s?in\\s?1|капучино|латте`],
    ['grain', `сахар|sugar|${W('мука|муки')}|flour|${W('рис|риса')}|${W('rice')}|греч|крупа|${W('соль')}|${W('salt')}|геркулес|овсян|${W('oats?')}|пшен|манка|күрүч`],
    ['household', `порош|шампун|shampoo|${W('мыло')}|${W('soap')}|ariel|ариэль|${W('tide')}|тайд|fairy|фейри|туалетн|бумаг|салфет|зубн|отбел|domestos|доместос|persil|чистящ|губк`],
  ] as [ProductKind, string][]
).map(([kind, src]) => [kind, new RegExp(src, 'iu')])

export function productKind(name: string): ProductKind {
  const text = name.toLowerCase().replace(/ё/g, 'е')
  for (const [kind, re] of RULES) if (re.test(text)) return kind
  return 'box'
}

// Оттенок подложки плитки: смешивается с поверхностью темы в CSS, поэтому хорошо смотрится и в светлой, и в тёмной.
const HUE: Record<ProductKind, string> = {
  cola: '#b0603a',
  orangeSoda: '#f28a1c',
  lemonSoda: '#8fbf2f',
  water: '#2c8be0',
  energy: '#2b59c3',
  beer: '#d89b2b',
  juice: '#f59e2b',
  milk: '#3b82d6',
  kefir: '#2f9e5b',
  yogurt: '#c25aa0',
  butter: '#e8b53a',
  oil: '#d9a520',
  bread: '#c98a45',
  chips: '#f08a24',
  gum: '#2bb3a3',
  chocolate: '#a8673f',
  candy: '#f2457f',
  cookies: '#c98a45',
  corn: '#e8b51a',
  canned: '#cf5b3e',
  tea: '#2f8a57',
  coffee: '#a8673f',
  eggs: '#c9a46a',
  noodles: '#e94e3c',
  grain: '#b0773b',
  cheese: '#e0a92a',
  sausage: '#c0503a',
  icecream: '#e86b9a',
  household: '#2f8fd6',
  box: '#9a7b4f',
}

// ---- рисунки (viewBox 48×48). Мягкая тень под предметом + блик слева — общий «наклеечный» стиль.

const Shadow = ({ rx = 11 }: { rx?: number }) => <ellipse cx="24" cy="43.6" rx={rx} ry="1.9" fill="#000" opacity=".14" />
const Shine = ({ d }: { d: string }) => <path d={d} stroke="#fff" strokeOpacity=".38" strokeWidth="1.7" strokeLinecap="round" fill="none" />

function Bottle({ liquid, dark, cap, label, stripe, bubbles }: { liquid: string; dark: string; cap: string; label: string; stripe: string; bubbles?: boolean }) {
  return (
    <>
      <Shadow rx={9} />
      <rect x="20.4" y="3.6" width="7.2" height="4.8" rx="1.4" fill={cap} />
      <rect x="19.8" y="7.6" width="8.4" height="1.7" rx=".85" fill={dark} opacity=".55" />
      <path d="M21 9.2h6v2.5c0 1.3.7 2.4 1.8 3.2 1.9 1.4 3.2 3.4 3.2 5.8v17.8a4 4 0 0 1-4 4h-8a4 4 0 0 1-4-4V20.7c0-2.4 1.3-4.4 3.2-5.8 1.1-.8 1.8-1.9 1.8-3.2z" fill={liquid} />
      <rect x="16" y="23" width="16" height="9.4" fill={label} />
      <rect x="16" y="26.8" width="16" height="1.9" fill={stripe} />
      <path d="M17.2 39.6h13.6" stroke={dark} strokeWidth="1.2" strokeLinecap="round" opacity=".45" />
      {bubbles && (
        <g fill="#fff" opacity=".7">
          <circle cx="27.6" cy="18" r="1" />
          <circle cx="25.4" cy="35.6" r=".8" />
          <circle cx="28.2" cy="37.2" r="1.1" />
        </g>
      )}
      <Shine d="M19 18.4c-.9 1-1.3 2.1-1.3 3.4v16.6" />
    </>
  )
}

function Can({ body, top = '#dfe4e8', children }: { body: string; top?: string; children?: ReactNode }) {
  return (
    <>
      <Shadow rx={10} />
      <path d="M15 11.5c0-1.4 4-2.5 9-2.5s9 1.1 9 2.5v27c0 1.4-4 2.5-9 2.5s-9-1.1-9-2.5z" fill={body} />
      <path d="M15 13.4c0 1.4 4 2.5 9 2.5s9-1.1 9-2.5M15 37.2c0 1.4 4 2.5 9 2.5s9-1.1 9-2.5" stroke="#d3d9de" strokeWidth="1.5" fill="none" />
      <ellipse cx="24" cy="11.5" rx="9" ry="2.5" fill={top} />
      <ellipse cx="24" cy="11.5" rx="6.8" ry="1.7" fill="#c3cad0" />
      <rect x="22" y="10.4" width="4.2" height="1.6" rx=".8" fill="#99a3ab" />
      {children}
      <Shine d="M18.2 16.5v19.5" />
    </>
  )
}

function Carton({ body, top, band }: { body: string; top: string; band: string }) {
  return (
    <>
      <Shadow rx={10} />
      <path d="M18.5 10h11V6.9a.9.9 0 0 0-.9-.9h-9.2a.9.9 0 0 0-.9.9z" fill={top} />
      <path d="M15 17.2l3.5-7.2h11l3.5 7.2z" fill={top} />
      <path d="M24 10v7.2" stroke="#000" strokeOpacity=".15" strokeWidth="1" />
      <rect x="15" y="17" width="18" height="25" rx="1.6" fill={body} />
      <path d="M28.2 17H33v23.4a1.6 1.6 0 0 1-1.6 1.6h-3.2z" fill="#000" opacity=".06" />
      <rect x="15" y="26.6" width="18" height="8.4" fill={band} />
      <path d="M21.2 28.2c-1.3 1.7-2 2.8-2 3.8a2 2 0 0 0 4 0c0-1-.7-2.1-2-3.8z" fill="#fff" />
      <path d="M25 30.2h5M25 32.8h3.4" stroke="#fff" strokeOpacity=".75" strokeWidth="1.3" strokeLinecap="round" />
      <Shine d="M17.4 19.6v5" />
    </>
  )
}

function Art({ kind }: { kind: ProductKind }) {
  switch (kind) {
    case 'cola':
      return <Bottle liquid="#4a2318" dark="#2a120b" cap="#e3a12f" label="#f6efe4" stripe="#8b4a2b" bubbles />
    case 'orangeSoda':
      return <Bottle liquid="#f28a1c" dark="#b85f08" cap="#2f8f4e" label="#fff6e8" stripe="#f28a1c" bubbles />
    case 'lemonSoda':
      return <Bottle liquid="#c4e06b" dark="#7fa22a" cap="#2e9b4f" label="#ffffff" stripe="#2e9b4f" bubbles />
    case 'oil':
      return <Bottle liquid="#f2c12e" dark="#b88a0c" cap="#2f8a57" label="#2f8a57" stripe="#f6e7a6" />
    case 'water':
      return (
        <>
          <Shadow rx={9} />
          <rect x="20.4" y="3.6" width="7.2" height="4.8" rx="1.4" fill="#2c7be5" />
          <path d="M21 9.2h6v2.5c0 1.3.7 2.4 1.8 3.2 1.9 1.4 3.2 3.4 3.2 5.8v17.8a4 4 0 0 1-4 4h-8a4 4 0 0 1-4-4V20.7c0-2.4 1.3-4.4 3.2-5.8 1.1-.8 1.8-1.9 1.8-3.2z" fill="#d6eefb" />
          <path d="M16 22.5c2.7-1.3 5.3-1.3 8 0s5.3 1.3 8 0v16a4 4 0 0 1-4 4h-8a4 4 0 0 1-4-4z" fill="#8fcdf2" />
          <rect x="16" y="26" width="16" height="7.6" fill="#2c7be5" />
          <path d="M18.2 30.2c1.3-.9 2.6-.9 3.9 0s2.6.9 3.9 0 2.6-.9 3.9 0" stroke="#fff" strokeWidth="1.3" fill="none" strokeLinecap="round" />
          <Shine d="M19 18.4c-.9 1-1.3 2.1-1.3 3.4v16.6" />
        </>
      )
    case 'energy':
      return (
        <Can body="#2b59c3">
          <path d="M25.8 17.5l-5.6 9h3.6l-1.6 7.8 6-9.6h-3.7z" fill="#ffd23f" />
        </Can>
      )
    case 'beer':
      return (
        <Can body="#d89b2b">
          <rect x="15" y="21" width="18" height="10" fill="#fbf2dc" />
          <path d="M24 23v6.4M24 24.2l-2 1.4M24 24.2l2 1.4M24 26.4l-2 1.4M24 26.4l2 1.4" stroke="#b07714" strokeWidth="1.2" strokeLinecap="round" />
        </Can>
      )
    case 'juice':
      return (
        <>
          <Shadow rx={10} />
          <path d="M27.4 12.5l2.8-7.6 2.6 1" stroke="#e9eef2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <rect x="15" y="12" width="18" height="30" rx="2" fill="#f59e2b" />
          <path d="M15 14a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1.6H15z" fill="#d97e10" />
          <circle cx="24" cy="29" r="5.8" fill="#ffd36b" />
          <circle cx="24" cy="29" r="4.2" fill="#ffe7a3" />
          <path d="M24 25v8M20.2 29h7.6M21.3 26.3l5.4 5.4M26.7 26.3l-5.4 5.4" stroke="#f5b83a" strokeWidth=".9" />
          <path d="M24.2 23c1.5-1.8 3.5-2.1 4.8-1.7-.4 1.7-2.1 2.7-4.8 1.7z" fill="#3aa35b" />
          <path d="M28.6 17.2H33v23.2a1.6 1.6 0 0 1-1.6 1.6h-2.8z" fill="#000" opacity=".07" />
          <Shine d="M17.4 18v20" />
        </>
      )
    case 'milk':
      return <Carton body="#f5f7fa" top="#3b82d6" band="#3b82d6" />
    case 'kefir':
      return <Carton body="#f5f8f4" top="#2f9e5b" band="#2f9e5b" />
    case 'yogurt':
      return (
        <>
          <Shadow rx={9} />
          <path d="M14 17.5h20l-2.3 22a3 3 0 0 1-3 2.5h-9.4a3 3 0 0 1-3-2.5z" fill="#f6f2f8" />
          <path d="M14.8 25h18.4l-.95 9.2H15.75z" fill="#c25aa0" />
          <circle cx="21.2" cy="29.6" r="2" fill="#fff" />
          <circle cx="25.8" cy="29" r="1.5" fill="#fff" opacity=".85" />
          <rect x="12.4" y="14.4" width="23.2" height="4.2" rx="2.1" fill="#d7dce2" />
          <path d="M33.4 15l3.4-3" stroke="#d7dce2" strokeWidth="2.4" strokeLinecap="round" />
          <Shine d="M17 21l1.8 17" />
        </>
      )
    case 'butter':
      return (
        <>
          <Shadow rx={15} />
          <path d="M9 22l9-6h21l-9 6z" fill="#ffe08a" />
          <path d="M9 22h21v13H9z" fill="#f7c948" />
          <path d="M30 22l9-6v13l-9 6z" fill="#e0b13a" />
          <path d="M9 28h21v7H9z" fill="#fbfcfd" />
          <path d="M30 28l9-6v7l-9 6z" fill="#e6eaee" />
          <path d="M9 28h21l9-6" stroke="#d9a520" strokeWidth="1.2" fill="none" />
          <path d="M12.5 31.5h7" stroke="#e8b53a" strokeWidth="1.4" strokeLinecap="round" />
        </>
      )
    case 'bread':
      return (
        <>
          <Shadow rx={16} />
          <path d="M8.5 27.5C8.5 20 15.4 15 24 15s15.5 5 15.5 12.5V36a4 4 0 0 1-4 4h-23a4 4 0 0 1-4-4z" fill="#c98a45" />
          <path d="M8.5 27.5C8.5 20 15.4 15 24 15s15.5 5 15.5 12.5c0 1.9-1.6 3.5-3.5 3.5H12c-1.9 0-3.5-1.6-3.5-3.5z" fill="#e5ad60" />
          <path d="M15.6 21.4l2.4 4M22.6 19l2.4 4.4M29.6 20.4l2.4 4" stroke="#b9772f" strokeWidth="2" strokeLinecap="round" />
          <Shine d="M12.6 22.4c2-2.6 5-4.2 8.5-4.6" />
        </>
      )
    case 'chips':
      return (
        <>
          <Shadow rx={11} />
          <path d="M13 9l2.75-2 2.75 2 2.75-2L24 9l2.75-2 2.75 2 2.75-2L35 9c1.6 7.3 1.6 22.7 0 30l-2.75 2-2.75-2-2.75 2L24 39l-2.75 2-2.75-2-2.75 2L13 39c-1.6-7.3-1.6-22.7 0-30z" fill="#f08a24" />
          <path d="M13 9l2.75-2 2.75 2 2.75-2L24 9l2.75-2 2.75 2 2.75-2L35 9l.3 3H12.7zM12.7 36h22.6l-.3 3-2.75 2-2.75-2-2.75 2L24 39l-2.75 2-2.75-2-2.75 2L13 39z" fill="#d06d12" />
          <ellipse cx="24" cy="24.5" rx="7.4" ry="6.8" fill="#fff3c4" />
          <path d="M18.8 25.6c1.6-4.2 7.2-5.8 10.4-2.8-.9 4.2-6.8 6.2-10.4 2.8z" fill="#f6c343" />
          <circle cx="22.6" cy="24.6" r=".7" fill="#e59a1d" />
          <circle cx="25.6" cy="23.8" r=".6" fill="#e59a1d" />
          <Shine d="M15.6 14c-.6 4-.6 16 0 20.5" />
        </>
      )
    case 'gum':
      return (
        <>
          <Shadow rx={14} />
          <rect x="29.5" y="11" width="8.6" height="14" rx="1.6" fill="#e9fbf8" stroke="#bfe9e2" strokeWidth="1" transform="rotate(16 33.8 18)" />
          <rect x="8.5" y="17" width="27" height="16" rx="3.2" fill="#2bb3a3" />
          <rect x="8.5" y="22.3" width="27" height="5.4" fill="#ffffff" opacity=".92" />
          <path d="M12.4 25h8" stroke="#2bb3a3" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M26.6 26.6c1.5-2.4 3.8-2.9 5.4-2.3-.6 2-2.8 3.2-5.4 2.3z" fill="#5fd39a" />
          <Shine d="M11.4 19.6h12" />
        </>
      )
    case 'chocolate':
      return (
        <>
          <Shadow rx={12} />
          <g transform="rotate(-14 24 24)">
            <rect x="15" y="6.5" width="18" height="34" rx="2" fill="#6b3a1f" />
            <path d="M15 12.6h18M15 18.6h18M24 6.5v15" stroke="#4e2914" strokeWidth="1.2" />
            <path d="M16.4 8h6.2M25.4 8h6.2M16.4 14h6.2M25.4 14h6.2" stroke="#8a5434" strokeWidth="1" strokeLinecap="round" />
            <path d="M15 22.5l2.25-1.5 2.25 1.5 2.25-1.5 2.25 1.5 2.25-1.5 2.25 1.5 2.25-1.5L33 22.5v16a2 2 0 0 1-2 2H17a2 2 0 0 1-2-2z" fill="#3c6fd1" />
            <path d="M15 22.5l2.25-1.5 2.25 1.5 2.25-1.5 2.25 1.5 2.25-1.5 2.25 1.5 2.25-1.5L33 22.5" stroke="#e5e7ea" strokeWidth="1.3" fill="none" strokeLinejoin="round" />
            <rect x="15" y="29.5" width="18" height="4" fill="#e8b53a" />
            <Shine d="M17.4 25v13" />
          </g>
        </>
      )
    case 'candy':
      return (
        <>
          <Shadow rx={13} />
          <path d="M10.2 17.4l6.4 6.6-6.4 6.6c-1.1-1.6-1.6-3.8-1.6-6.6s.5-5 1.6-6.6zM37.8 17.4l-6.4 6.6 6.4 6.6c1.1-1.6 1.6-3.8 1.6-6.6s-.5-5-1.6-6.6z" fill="#f585ad" />
          <ellipse cx="24" cy="24" rx="9.2" ry="7.6" fill="#f2457f" />
          <path d="M19.4 17.6c2.2 3.8 2.2 8 0 12.8M25.2 16.6c2.2 4.4 2.2 10.4 0 14.8" stroke="#fff" strokeOpacity=".75" strokeWidth="1.7" fill="none" strokeLinecap="round" />
        </>
      )
    case 'cookies':
      return (
        <>
          <Shadow rx={13} />
          <circle cx="24" cy="24.5" r="14" fill="#d79a52" />
          <circle cx="24" cy="24.5" r="12.6" fill="none" stroke="#c4843f" strokeWidth="1.2" strokeDasharray="2 2.6" />
          <g fill="#5a3216">
            <circle cx="18.5" cy="19.5" r="1.9" />
            <circle cx="27" cy="17.6" r="1.6" />
            <circle cx="30.4" cy="25.4" r="2" />
            <circle cx="21.6" cy="27.4" r="1.7" />
            <circle cx="25.4" cy="32" r="1.6" />
            <circle cx="16.6" cy="29.4" r="1.3" />
          </g>
          <Shine d="M14.2 20.6c1.4-3.4 4.2-5.8 7.6-6.6" />
        </>
      )
    case 'corn':
      return (
        <>
          <Shadow rx={11} />
          <rect x="13" y="13" width="22" height="27" rx="2.5" fill="#f2c230" />
          <path d="M13 15.6h22v2.4H13zM13 35.2h22v2.4H13z" fill="#d7dde2" />
          <ellipse cx="24" cy="13" rx="11" ry="3" fill="#dfe4e8" />
          <ellipse cx="24" cy="13" rx="8.8" ry="2.1" fill="#c3cad0" />
          <path d="M19.4 33.6c-1.4-4.6.4-9.4 4.6-11.4-.6 4.4.4 8.6 2 11.4z" fill="#3aa35b" />
          <ellipse cx="25.4" cy="26.6" rx="3.4" ry="6" fill="#ffe27a" />
          <g fill="#f5b700">
            <circle cx="24.4" cy="23.2" r=".8" />
            <circle cx="26.6" cy="23.6" r=".8" />
            <circle cx="24.2" cy="26.2" r=".8" />
            <circle cx="26.6" cy="26.6" r=".8" />
            <circle cx="24.6" cy="29.4" r=".8" />
            <circle cx="26.6" cy="29.6" r=".8" />
          </g>
          <Shine d="M15.6 20v13" />
        </>
      )
    case 'canned':
      return (
        <>
          <Shadow rx={11} />
          <rect x="13" y="13" width="22" height="27" rx="2.5" fill="#cf5b3e" />
          <path d="M13 15.6h22v2.4H13zM13 35.2h22v2.4H13z" fill="#d7dde2" />
          <ellipse cx="24" cy="13" rx="11" ry="3" fill="#dfe4e8" />
          <ellipse cx="24" cy="13" rx="8.8" ry="2.1" fill="#c3cad0" />
          <rect x="13" y="21.6" width="22" height="9.8" fill="#fbf2e6" />
          <circle cx="19.4" cy="26.5" r="3" fill="#cf5b3e" />
          <path d="M24.4 25.2h6.4M24.4 28h4.4" stroke="#cf5b3e" strokeWidth="1.5" strokeLinecap="round" />
          <Shine d="M15.6 20v13" />
        </>
      )
    case 'tea':
      return (
        <>
          <Shadow rx={12} />
          <rect x="12" y="12.5" width="24" height="28" rx="2.2" fill="#2f8a57" />
          <path d="M12 14.7a2.2 2.2 0 0 1 2.2-2.2h19.6a2.2 2.2 0 0 1 2.2 2.2V19H12z" fill="#246e45" />
          <path d="M18.4 34c0-6 4.2-9.8 10.8-10.2.4 6.4-3.6 10.6-10.8 10.2z" fill="#9be08a" />
          <path d="M19 33.4c2.6-3 5.4-5 8.8-7" stroke="#2f8a57" strokeWidth="1.2" fill="none" strokeLinecap="round" />
          <Shine d="M14.6 22v15" />
        </>
      )
    case 'coffee':
      return (
        <>
          <Shadow rx={11} />
          <rect x="14" y="16" width="20" height="25.5" rx="3.6" fill="#6e3f22" />
          <rect x="13" y="10" width="22" height="7" rx="2" fill="#d4a017" />
          <path d="M13 13.5h22" stroke="#b88a0c" strokeWidth="1" />
          <rect x="14" y="23.4" width="20" height="10.4" fill="#f3e6d3" />
          <ellipse cx="24" cy="28.6" rx="3.8" ry="2.7" fill="#6b3a1f" transform="rotate(-25 24 28.6)" />
          <path d="M21.6 30c1.5-1 3.3-1.8 4.8-2.8" stroke="#f3e6d3" strokeWidth="1" fill="none" strokeLinecap="round" />
          <Shine d="M16.6 19v19.5" />
        </>
      )
    case 'eggs':
      return (
        <>
          <Shadow rx={15} />
          <path d="M19 11.5c4 0 7 6.6 7 11.6S23 31 19 31s-7-2.9-7-7.9 3-11.6 7-11.6z" fill="#f3dfc1" />
          <path d="M30 15.5c4.2 0 7.3 6.8 7.3 12S34.2 36 30 36s-7.3-3.3-7.3-8.5 3.1-12 7.3-12z" fill="#fff6e8" stroke="#ead8bb" strokeWidth="1" />
          <path d="M8 30.5h32l-2.4 9.6a2 2 0 0 1-2 1.4H12.4a2 2 0 0 1-2-1.4z" fill="#cbb89c" />
          <path d="M16 30.5v11M24 30.5v11M32 30.5v11" stroke="#b49f80" strokeWidth="1.1" />
          <Shine d="M15.4 17.4c-.8 1.4-1.3 3-1.4 4.6" />
        </>
      )
    case 'noodles':
      return (
        <>
          <Shadow rx={11} />
          <path d="M28.4 3.6l-6 15M33.4 4.6l-8.2 14" stroke="#c49a6c" strokeWidth="1.9" strokeLinecap="round" />
          <path d="M12 17.5h24l-3 22a3 3 0 0 1-3 2.5H18a3 3 0 0 1-3-2.5z" fill="#e94e3c" />
          <path d="M12.95 24.5h22.1l-.82 6H13.77z" fill="#fff" />
          <path d="M17 27.5h6" stroke="#e94e3c" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M13.4 17.2c2-3.2 4 2 6-1.2s4 2 6-1.2 4 2 6-1.2 2.4.8 3.4 1.2" stroke="#f6d36b" strokeWidth="2.3" fill="none" strokeLinecap="round" />
          <rect x="11" y="16" width="26" height="3.2" rx="1.6" fill="#f3f3f3" />
          <Shine d="M15.6 21l1.8 17" />
        </>
      )
    case 'grain':
      return (
        <>
          <Shadow rx={13} />
          <path d="M15.2 14.6c-3 5-4.2 10-4.2 15 0 7 3.6 12 13 12s13-5 13-12c0-5-1.2-10-4.2-15z" fill="#efe2c4" />
          <path d="M17.6 14.6h12.8l-2.2-5.4c-.3-.7-1-1.2-1.8-1.2h-4.8c-.8 0-1.5.5-1.8 1.2z" fill="#e3d0a7" />
          <rect x="16.4" y="12.8" width="15.2" height="3.2" rx="1.6" fill="#b0773b" />
          <circle cx="24" cy="29.4" r="5.4" fill="#d9c495" />
          <path d="M24 25.4v8M24 27.2l-1.8-1.4M24 27.2l1.8-1.4M24 29.6l-1.8-1.4M24 29.6l1.8-1.4" stroke="#a0732f" strokeWidth="1.1" strokeLinecap="round" />
          <Shine d="M15 22.6c-.8 2.4-1.2 4.8-1.2 7" />
        </>
      )
    case 'cheese':
      return (
        <>
          <Shadow rx={16} />
          <path d="M8 30l25-14.4c1-.6 2.3-.4 3.1.4L40 20v10z" fill="#ffd95c" />
          <path d="M8 30h32v8a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2z" fill="#f2c23e" />
          <g fill="#e0a92a">
            <circle cx="15" cy="34.6" r="2.2" />
            <circle cx="24.4" cy="36" r="1.6" />
            <circle cx="32.6" cy="33.8" r="2" />
            <ellipse cx="27" cy="25.4" rx="2" ry="1.2" />
            <ellipse cx="34.2" cy="21.6" rx="1.4" ry=".9" />
          </g>
        </>
      )
    case 'sausage':
      return (
        <>
          <Shadow rx={15} />
          <path d="M11 31.5c4.4-12 23-15.6 28.4-7.6" stroke="#b9442f" strokeWidth="9.4" strokeLinecap="round" fill="none" />
          <path d="M11 31.5c4.4-12 23-15.6 28.4-7.6" stroke="#d65d45" strokeWidth="6.6" strokeLinecap="round" fill="none" />
          <path d="M15 27c5-7 16.6-9.6 22.4-5.6" stroke="#fff" strokeOpacity=".32" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          <path d="M8.6 34.4l-2-1.2M41.6 22.2l1.8-1.4" stroke="#8a3322" strokeWidth="1.6" strokeLinecap="round" />
        </>
      )
    case 'icecream':
      return (
        <>
          <Shadow rx={6} />
          <path d="M17 24h14l-7 18.5z" fill="#e3a557" />
          <path d="M19 27.4l8.6 6M18.4 24.6l10.2 7.2M29 27.4l-8.6 6M29.6 24.6l-10.2 7.2" stroke="#c98838" strokeWidth="1" />
          <circle cx="24" cy="17.4" r="8.4" fill="#f7a8c4" />
          <path d="M15.8 19.4c1.6 2.6 3.2 2.6 4.2 5 1.4-1.6 3.2-1.6 4 .2 1.2-2 3-2 4.2-.4.9-2 2.4-2.6 3.6-4.6" fill="#f7a8c4" />
          <circle cx="27" cy="11.6" r="1.6" fill="#e2435f" />
          <Shine d="M18.6 13.6c1.2-1.8 3-2.8 5-3" />
        </>
      )
    case 'household':
      return (
        <>
          <Shadow rx={10} />
          <rect x="17.4" y="8.4" width="7.6" height="6.4" rx="1.5" fill="#eef1f4" />
          <path d="M17.6 14.6h11a3.4 3.4 0 0 1 3.4 3.4v20.6a3.4 3.4 0 0 1-3.4 3.4h-11a3.4 3.4 0 0 1-3.4-3.4V18a3.4 3.4 0 0 1 3.4-3.4z" fill="#4aa3df" />
          <rect x="26" y="17.6" width="3.4" height="8.4" rx="1.7" fill="#2f86c4" />
          <rect x="16.6" y="27.6" width="13" height="9" rx="1.6" fill="#fff" />
          <g fill="#7cc2ef">
            <circle cx="20.4" cy="31.4" r="1.6" />
            <circle cx="24.4" cy="33.4" r="1.2" />
            <circle cx="25.4" cy="30.2" r=".9" />
          </g>
          <Shine d="M16.8 18.6v6" />
        </>
      )
    case 'box':
    default:
      return (
        <>
          <Shadow rx={14} />
          <path d="M9 17l15-7 15 7-15 7z" fill="#e4c393" />
          <path d="M9 17l15 7v17L9 34z" fill="#cfa266" />
          <path d="M39 17L24 24v17l15-7z" fill="#b8884a" />
          <path d="M16.4 13.6l15 7v4.2l-3.4-1.6v-1.4l-15-7z" fill="#f4e3c4" />
          <path d="M12.6 26.4l6.4 3" stroke="#a97b42" strokeWidth="1.3" strokeLinecap="round" />
        </>
      )
  }
}

/** Плитка с рисунком товара. Нет на полке — плитка гаснет: глаз сразу видит пустое место. */
export function ProductIcon({ name, size = 40, empty = false }: { name: string; size?: number; empty?: boolean }) {
  const kind = productKind(name)
  const style = { '--pi-hue': HUE[kind], '--pi-size': `${size}px` } as CSSProperties
  return (
    <span className={`pi${empty ? ' pi--empty' : ''}`} style={style} data-kind={kind} data-testid="product-icon" aria-hidden>
      <svg viewBox="0 0 48 48" className="pi__art" focusable="false">
        <Art kind={kind} />
      </svg>
    </span>
  )
}
