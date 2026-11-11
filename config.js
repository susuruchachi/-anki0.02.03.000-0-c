// ★ バージョン情報は version-info.js で管理
// （このファイルは version-info.js を読み込んでから使用）

// ★Firebase 初期化 (ご自身のConfigに置き換えてください)
const firebaseConfig = {
  apiKey: "AIzaSyAGoYBRoupEFHng_cXoiHmZf9eAlX8ZCHA", authDomain: "susuruanki.firebaseapp.com",
  projectId: "susuruanki", storageBucket: "susuruanki.firebasestorage.app",
  messagingSenderId: "926791749187", appId: "1:926791749187:web:2a96a39d61cbb4d3c7cef6", measurementId: "G-Q9ZMYX8BF8"
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth(); const firestore = firebase.firestore();
// ★【0.04.11】回線・端末（Android アプリなど）によって、Firestore のリアルタイムの接続が詰まり、チャットや一覧が出てこないことがあった。
//  詰まる環境では自動で別の接続方式（ロングポーリング）に切り替える
try { firestore.settings({ experimentalAutoDetectLongPolling: true, merge: true }); } catch (e) {}

const STORAGE_KEY = 'susuru_anki_022g';
let currentUser = null, db = [], categories = ["未分類"], categoryTree = {};
let currentViewContext = 'all', pageHistory = [];
let chartInstance = null, currentCombo = 0, todayCorrectCount = 0;
let quizPool=[], quizIndex=0, quizTimer=null, autoNextTimeout=null;
let quizTimeLimit=0, quizTimeLeft=0, quizPhase='q', selectedChoiceIdx=null, currentQuestionGradThreshold=5, selectedScopePath=[];
let syncTimeout = null;
let lastQuizScopePath = []; // クイズ終了後もカテゴリー選択を保持
let shareStats = false; // 成績共有フラグ

// ★ ライブ同期用変数
let subscribedDocs = []; // 購読している共有ドキュメントIDの配列
let ownedDocs = []; // 自分が作成した共有ドキュメントIDの配列
let sharedDocPermissions = {}; // 各ドキュメントの編集権限キャッシュ { docId: { canEdit: boolean } }

function getTodayStr() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().split('T')[0];
}
