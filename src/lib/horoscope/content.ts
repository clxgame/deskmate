import type { FortuneDimension } from "./types";

type LocalizedText = readonly [zh: string, en: string, ja: string, ko: string];
type Scope = FortuneDimension | "all";
type Band = "high" | "low" | "neutral";

function entry<const I extends string, const S extends Scope>(id: I, scope: S, ...text: LocalizedText) {
  return { id, scope, text } as const;
}

function message<const I extends string, const S extends Scope, const B extends Band>(
  id: I, scope: S, band: B, ...text: LocalizedText
) {
  return { id, scope, band, text } as const;
}

export const LUCKY_COLORS = [
  entry("coral", "all", "珊瑚橘", "Coral", "コーラル", "코랄"),
  entry("mint", "all", "薄荷绿", "Mint green", "ミントグリーン", "민트 그린"),
  entry("lavender", "all", "薰衣草紫", "Lavender", "ラベンダー", "라벤더"),
  entry("sky", "all", "天空蓝", "Sky blue", "スカイブルー", "하늘색"),
  entry("peach", "all", "蜜桃粉", "Peach pink", "ピーチピンク", "피치 핑크"),
  entry("sage", "all", "鼠尾草绿", "Sage green", "セージグリーン", "세이지 그린"),
  entry("amber", "all", "琥珀黄", "Amber", "アンバー", "앰버"),
  entry("cream", "all", "奶油白", "Cream", "クリーム", "크림색"),
  entry("teal", "all", "青蓝", "Teal", "ティール", "청록색"),
  entry("rose", "all", "玫瑰粉", "Rose pink", "ローズピンク", "로즈 핑크"),
] as const;

/** High-score suggestions plus gentle fallbacks when no dimension is high. */
export const ADVICE_ITEMS = [
  entry("career_focus", "career", "先完成最重要的一件事", "Finish the most important task first", "まず一番大事なことを終える", "가장 중요한 일부터 마무리하기"),
  entry("career_share", "career", "把好点子说出来", "Share a good idea", "よいアイデアを伝える", "좋은 아이디어 나누기"),
  entry("career_finish", "career", "收好手边的进度", "Wrap up a task in progress", "進めている作業を仕上げる", "진행 중인 일 마무리하기"),
  entry("wealth_plan", "wealth", "整理一笔小预算", "Review a small budget", "小さな予算を見直す", "작은 예산 살펴보기"),
  entry("wealth_compare", "wealth", "比较一下需要的选项", "Compare options you need", "必要な選択肢を比べる", "필요한 선택지 비교하기"),
  entry("wealth_save", "wealth", "留下一点余裕", "Set a little aside", "少し余裕を残す", "조금 여유 자금 남기기"),
  entry("love_listen", "love", "认真听一句心里话", "Listen closely to someone", "相手の気持ちに耳を傾ける", "상대의 마음을 차분히 듣기"),
  entry("love_reach", "love", "给在意的人发个问候", "Send someone a warm hello", "大切な人に声をかける", "소중한 사람에게 안부 전하기"),
  entry("love_thank", "love", "说出一声谢谢", "Say a sincere thank you", "感謝を言葉にする", "고마운 마음 전하기"),
  entry("energy_walk", "energy", "走一小段路透透气", "Take a short walk", "少し歩いて気分転換する", "잠깐 걸으며 바람 쐬기"),
  entry("energy_stretch", "energy", "起身舒展一下", "Stand up and stretch", "立ち上がって体を伸ばす", "일어나서 가볍게 스트레칭하기"),
  entry("energy_create", "energy", "试试一件有趣的小事", "Try something small and fun", "小さな楽しいことを試す", "작고 즐거운 일 해 보기"),
  entry("all_priority", "all", "写下今天的小目标", "Write down a small goal", "今日の小さな目標を書く", "오늘의 작은 목표 적기"),
  entry("all_pause", "all", "给自己留片刻安静", "Make room for a quiet moment", "静かなひとときを作る", "잠깐 조용한 시간 갖기"),
  entry("all_notice", "all", "留意一件顺心的小事", "Notice one pleasant moment", "うれしい小さな出来事に目を向ける", "기분 좋은 작은 순간 찾기"),
  entry("all_checkin", "all", "问问自己现在需要什么", "Check in with what you need", "今の自分に必要なことを確かめる", "지금 나에게 필요한 것 살피기"),
] as const;

/** Low-score cautions plus non-predictive fallbacks. */
export const CAUTION_ITEMS = [
  entry("career_overcommit", "career", "别一下接太多事", "Avoid taking on too much at once", "一度に抱え込みすぎない", "한꺼번에 너무 많은 일을 맡지 않기"),
  entry("career_rush", "career", "重要细节别匆匆略过", "Do not rush past key details", "大事な細部を急いで見落とさない", "중요한 세부 사항 서둘러 넘기지 않기"),
  entry("career_compare", "career", "别用别人的进度催自己", "Do not measure your pace against others", "人の進み具合と比べて焦らない", "남의 속도와 비교하며 조급해하지 않기"),
  entry("wealth_impulse", "wealth", "购物车先别急着结算", "Pause before checking out your cart", "買い物かごの決済はひと呼吸置く", "장바구니 결제는 잠깐 미루기"),
  entry("wealth_lend", "wealth", "别仓促答应金钱请求", "Do not rush a money decision for someone", "お金の頼み事に即答しない", "금전 부탁에 서둘러 답하지 않기"),
  entry("wealth_ignore", "wealth", "小额花费也记得看一眼", "Keep an eye on small expenses", "小さな出費も見落とさない", "작은 지출도 살펴보기"),
  entry("love_assume", "love", "别替对方猜完心思", "Do not assume what someone means", "相手の気持ちを決めつけない", "상대 마음을 혼자 단정하지 않기"),
  entry("love_reply", "love", "情绪上来时别急着回复", "Pause before replying when upset", "気持ちが高ぶったら返信を急がない", "감정이 올라올 때 바로 답하지 않기"),
  entry("love_withdraw", "love", "别把小误会闷在心里", "Do not sit on a small misunderstanding", "小さな行き違いを抱え込まない", "작은 오해를 혼자 쌓아 두지 않기"),
  entry("energy_skiprest", "energy", "别把休息排到最后", "Do not put rest last", "休むことを後回しにしない", "휴식을 맨 뒤로 미루지 않기"),
  entry("energy_stayup", "energy", "今晚别硬撑着熬夜", "Do not push through a late night", "今夜は無理して夜更かししない", "오늘 밤 무리해서 늦게 자지 않기"),
  entry("energy_overdo", "energy", "别勉强自己一直满格", "Do not force yourself to stay at full speed", "ずっと全力でいようと無理しない", "계속 전력 질주하려 애쓰지 않기"),
  entry("all_fill", "all", "别把每分钟都排满", "Leave some space in the day", "一日を予定で埋め尽くさない", "하루를 빈틈없이 채우지 않기"),
  entry("all_hurry", "all", "别为了赶快而跳过确认", "Do not skip a check just to go faster", "急ぐために確認を省かない", "빨리 끝내려 확인을 건너뛰지 않기"),
  entry("all_perfect", "all", "别要求自己事事完美", "Do not demand perfection of yourself", "何もかも完璧にしようとしない", "모든 일을 완벽하게 하려 애쓰지 않기"),
  entry("all_dismiss", "all", "别忽略自己的感受", "Do not brush off how you feel", "自分の気持ちを見過ごさない", "내 마음을 무시하지 않기"),
] as const;

/** Commentary follows the strongest applicable state, with neutral alternatives. */
export const MESSAGE_ITEMS = [
  message("career_high_flow", "career", "high", "今天做事有节奏，Yume 给你比个赞。", "Your work has a nice rhythm today. Yume cheers you on.", "今日は作業の調子がよさそう。Yume も応援しているよ。", "오늘 일의 흐름이 좋아 보여요. Yume가 응원할게요."),
  message("career_high_idea", "career", "high", "好点子值得试试，Yume 在旁边加油。", "A good idea is worth trying. Yume is rooting for you.", "よいアイデア、試してみてね。Yume もそばで応援するよ。", "좋은 생각은 시도해 볼 만해요. Yume가 곁에서 응원해요."),
  message("career_high_step", "career", "high", "把握手边一步，Yume 陪你慢慢推进。", "Take the next step at hand. Yume is with you.", "目の前の一歩を進めよう。Yume も一緒だよ。", "눈앞의 한 걸음에 집중해요. Yume가 함께할게요."),
  message("career_low_one", "career", "low", "工作先挑一件小事，Yume 陪你开头。", "Start with one small task. Yume will keep you company.", "仕事は小さなことから。Yume も一緒に始めるよ。", "일은 작은 것 하나부터 시작해요. Yume가 함께할게요."),
  message("career_low_breathe", "career", "low", "进度慢一点也没关系，Yume 在这里。", "A slower pace is okay. Yume is here.", "ゆっくり進んでも大丈夫。Yume はここにいるよ。", "조금 느려도 괜찮아요. Yume가 여기 있어요."),
  message("career_low_reset", "career", "low", "卡住时换个顺序，Yume 相信你能找到路。", "If you feel stuck, try a new order. Yume believes in you.", "行き詰まったら順番を変えてみて。Yume は応援しているよ。", "막힐 땐 순서를 바꿔 봐요. Yume가 응원해요."),
  message("wealth_high_steady", "wealth", "high", "今天适合从容规划，Yume 提醒你留点余裕。", "Plan at an easy pace today. Yume says to leave some room.", "今日はゆとりを持って計画を。Yume からの小さな提案だよ。", "오늘은 여유롭게 계획해 봐요. Yume가 작은 여유도 챙기래요."),
  message("wealth_high_choice", "wealth", "high", "清楚自己需要什么，就是很棒的选择。Yume 点头。", "Knowing what you need is a good start. Yume nods along.", "必要なものが分かるのはいいこと。Yume もうなずいているよ。", "필요한 것을 아는 것부터 좋아요. Yume도 고개를 끄덕여요."),
  message("wealth_high_care", "wealth", "high", "照顾好小计划，Yume 为你的细心鼓掌。", "Take care of your small plan. Yume applauds your care.", "小さな計画を大切に。Yume も丁寧さに拍手するよ。", "작은 계획을 잘 챙겨요. Yume가 세심함에 박수쳐요."),
  message("wealth_low_pause", "wealth", "low", "花钱的事先缓一缓，Yume 陪你想清楚。", "Take your time with spending. Yume can wait with you.", "買い物は少し待っても大丈夫。Yume も一緒に考えるよ。", "지출은 잠깐 미뤄도 돼요. Yume가 함께 생각해요."),
  message("wealth_low_enough", "wealth", "low", "今天先照顾必需的，Yume 觉得这样很踏实。", "Focus on essentials today. Yume thinks that is enough.", "今日は必要なものを優先して。Yume はそれで十分だと思うよ。", "오늘은 꼭 필요한 것부터 챙겨요. Yume는 그걸로 충분하다고 생각해요."),
  message("wealth_low_simple", "wealth", "low", "预算只需看清一小块，Yume 不催你。", "You can review one small part of your budget. Yume will not rush you.", "予算は小さな一部分だけ見てもいいよ。Yume は急かさないよ。", "예산의 작은 부분만 살펴봐도 돼요. Yume는 재촉하지 않아요."),
  message("love_high_warm", "love", "high", "一句真诚的话就很温暖，Yume 也感受到了。", "A sincere word can feel warm. Yume feels it too.", "素直なひと言って温かいね。Yume にも伝わったよ。", "진심 어린 한마디가 따뜻해요. Yume도 느꼈어요."),
  message("love_high_near", "love", "high", "把关心送出去，Yume 在一旁轻轻鼓掌。", "Share your care. Yume is quietly cheering.", "思いやりを届けてね。Yume もそっと拍手するよ。", "따뜻한 마음을 전해요. Yume가 조용히 박수쳐요."),
  message("love_high_listen", "love", "high", "愿意倾听的你很可爱，Yume 记下了。", "Your willingness to listen is lovely. Yume noticed.", "耳を傾けるあなた、すてきだね。Yume は気づいたよ。", "귀 기울이는 모습이 참 좋아요. Yume도 봤어요."),
  message("love_low_gentle", "love", "low", "关系里的小停顿没关系，Yume 陪你放轻松。", "A quiet moment in a relationship is okay. Yume is here.", "関係に少し間があっても大丈夫。Yume もそばにいるよ。", "관계에 잠깐의 쉼표가 있어도 괜찮아요. Yume가 곁에 있어요."),
  message("love_low_words", "love", "low", "先想想要说什么，Yume 不催你开口。", "Take time to find your words. Yume will not rush you.", "言葉を探す時間を取ってね。Yume は急かさないよ。", "무슨 말을 할지 천천히 생각해요. Yume는 재촉하지 않아요."),
  message("love_low_self", "love", "low", "照顾自己的心情也重要，Yume 知道。", "Your feelings matter too. Yume knows.", "自分の気持ちも大切にしてね。Yume は分かっているよ。", "내 마음을 돌보는 것도 중요해요. Yume가 알아요."),
  message("energy_high_move", "energy", "high", "有精神的时候动一动，Yume 跟着你摇摆。", "Move a little while you feel lively. Yume joins in.", "元気なときに少し動こう。Yume も一緒に揺れるよ。", "기운이 날 때 조금 움직여 봐요. Yume도 함께할게요."),
  message("energy_high_bright", "energy", "high", "今天的轻快劲儿真好，Yume 也被感染了。", "Your light mood is catching. Yume feels it too.", "今日の軽やかさ、いいね。Yume にも伝わったよ。", "오늘의 가벼운 기분이 좋아요. Yume에게도 전해졌어요."),
  message("energy_high_balance", "energy", "high", "有余力也记得留白，Yume 提醒你喝口水。", "Even with energy to spare, leave a pause. Yume says have some water.", "余裕があっても休憩を。Yume から水分補給の合図だよ。", "여유가 있어도 잠깐 쉬어요. Yume가 물 한 잔 권해요."),
  message("energy_low_rest", "energy", "low", "累了就歇一会儿，Yume 会安静陪着。", "Rest if you feel tired. Yume will sit quietly with you.", "疲れたら休んでね。Yume は静かにそばにいるよ。", "피곤하면 쉬어 가요. Yume가 조용히 곁에 있을게요."),
  message("energy_low_small", "energy", "low", "今天慢慢来就好，Yume 不赶时间。", "Take today slowly. Yume is in no hurry.", "今日はゆっくりでいいよ。Yume も急がないよ。", "오늘은 천천히 해도 돼요. Yume도 서두르지 않아요."),
  message("energy_low_kind", "energy", "low", "先照顾好自己，Yume 给你留个软软的位置。", "Look after yourself first. Yume saved you a cozy spot.", "まずは自分を大切に。Yume が心地よい場所を空けているよ。", "먼저 자신을 돌봐요. Yume가 포근한 자리를 남겨 뒀어요."),
  message("all_today", "all", "neutral", "今天也从一小步开始吧，Yume 陪着你。", "Start with one small step today. Yume is with you.", "今日も小さな一歩から。Yume も一緒だよ。", "오늘도 작은 한 걸음부터 시작해요. Yume가 함께해요."),
  message("all_calm", "all", "neutral", "普通的一天也值得好好过，Yume 这样觉得。", "An ordinary day deserves care too. Yume thinks so.", "何気ない一日も大切に。Yume はそう思うよ。", "평범한 하루도 소중해요. Yume는 그렇게 생각해요."),
  message("all_room", "all", "neutral", "给今天留一点弹性，Yume 在这里等你。", "Leave a little room in your day. Yume is here.", "今日に少し余白を。Yume はここにいるよ。", "오늘에 작은 여유를 남겨요. Yume가 여기 있어요."),
  message("all_good", "all", "neutral", "记得看看那些微小的好，Yume 正在看。", "Look for the little good things. Yume is looking too.", "小さないいことに目を向けて。Yume も探しているよ。", "작은 좋은 일들을 살펴봐요. Yume도 찾고 있어요."),
] as const;

export type LuckyColorId = (typeof LUCKY_COLORS)[number]["id"];
export type AdviceId = (typeof ADVICE_ITEMS)[number]["id"];
export type CautionId = (typeof CAUTION_ITEMS)[number]["id"];
export type MessageId = (typeof MESSAGE_ITEMS)[number]["id"];

type TextEntry = { readonly id: string; readonly text: LocalizedText };

function textMap<T extends string>(items: readonly TextEntry[], index: number): Readonly<Record<T, string>> {
  return Object.fromEntries(items.map(({ id, text }) => [id, text[index]])) as Record<T, string>;
}

export interface HoroscopeContent {
  readonly colors: Readonly<Record<LuckyColorId, string>>;
  readonly advice: Readonly<Record<AdviceId, string>>;
  readonly cautions: Readonly<Record<CautionId, string>>;
  readonly messages: Readonly<Record<MessageId, string>>;
}

const CONTENT_BY_LANGUAGE: Readonly<Record<"zh-CN" | "en-US" | "ja-JP" | "ko-KR", HoroscopeContent>> = {
  "zh-CN": makeContent(0),
  "en-US": makeContent(1),
  "ja-JP": makeContent(2),
  "ko-KR": makeContent(3),
};

function makeContent(index: number): HoroscopeContent {
  return {
    colors: textMap<LuckyColorId>(LUCKY_COLORS, index),
    advice: textMap<AdviceId>(ADVICE_ITEMS, index),
    cautions: textMap<CautionId>(CAUTION_ITEMS, index),
    messages: textMap<MessageId>(MESSAGE_ITEMS, index),
  };
}

/** Unknown or unset language follows the main dictionary's Chinese fallback. */
export function horoscopeContent(language: string): HoroscopeContent {
  switch (language) {
    case "en-US": return CONTENT_BY_LANGUAGE["en-US"];
    case "ja-JP": return CONTENT_BY_LANGUAGE["ja-JP"];
    case "ko-KR": return CONTENT_BY_LANGUAGE["ko-KR"];
    default: return CONTENT_BY_LANGUAGE["zh-CN"];
  }
}
