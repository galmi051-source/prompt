import React, { useState, useEffect, useCallback, useRef, KeyboardEvent, useMemo } from 'react';
import { Copy, Wand2, Plus, X, ArrowUp, ArrowDown, Save, FolderOpen, Trash2, Loader2, BookText, Library, FilePlus2, ChevronDown, ChevronUp, Edit, LogIn, LogOut, Github, Search, EyeOff, Eye } from 'lucide-react';
import * as firebaseApp from 'firebase/app';
import * as firebaseAuth from 'firebase/auth';
import * as firestore from 'firebase/firestore';

// インターフェースの定義をすべて含めます
interface TranslationPair {
  id: string;
  name: string; // ★変更点: 翻訳ペアに名前を追加
  inputText: string;
  outputText: string;
  isJapaneseInput: boolean;
  isLoading: boolean;
  isUserEditingOutput: boolean;
  color: string;
  isDisabled: boolean; // ★追加: 翻訳ペアの無効化フラグ
}

interface SavedPrompt {
  id: string;
  name: string;
  group: string;
  inputText: string;
  outputText: string;
  isJapaneseInput: boolean;
  color: string;
  timestamp: firestore.Timestamp;
}

interface SavedPromptSet {
  id: string;
  name: string;
  group: string;
  pairs: Array<{
    inputText: string;
    outputText: string;
    isJapaneseInput: boolean;
    color: string;
  }>;
  timestamp: firestore.Timestamp;
}

interface UserDictionaryEntry {
  id: string;
  english: string;
  japanese: string;
  group: string;
  timestamp: firestore.Timestamp;
}

const colorPalette: string[] = [
  'text-rose-300',
  'text-amber-300',
  'text-lime-300',
  'text-cyan-300',
  'text-violet-300',
  'text-fuchsia-300',
  'text-emerald-300',
  'text-orange-300',
  'text-sky-300',
  'text-purple-300',
];


const AIPromptTranslator: React.FC = () => {
  const initialTranslationPairId = useRef(crypto.randomUUID());
  const [translationPairs, setTranslationPairs] = useState<TranslationPair[]>(() => [
    {
      id: initialTranslationPairId.current,
      name: '翻訳ペア 1', // ★変更点: 翻訳ペアの名前の初期値
      inputText: '',
      outputText: '',
      isJapaneseInput: false,
      isLoading: false,
      isUserEditingOutput: false,
      color: colorPalette[0],
      isDisabled: false, // ★初期値: 無効化されていない
    },
  ]);

  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);
  const [savedPromptSets, setSavedPromptSets] = useState<SavedPromptSet[]>([]);
  const [userDictionary, setUserDictionary] = useState<UserDictionaryEntry[]>([]);

  const [showSaveModal, setShowSaveModal] = useState<boolean>(false);
  const [saveName, setSaveName] = useState<string>('');
  const [saveGroup, setSaveGroup] = useState<string>('未分類');
  const [availableGroups, setAvailableGroups] = useState<string[]>([]);
  const [dictionaryWordGroup, setDictionaryWordGroup] = useState<string>('未分類');
  const [availableDictionaryGroups, setAvailableDictionaryGroups] = useState<string[]>([]);
  const [editDictionaryGroupName, setEditDictionaryGroupName] = useState<string | null>(null);
  const [tempEditedDictionaryGroupName, setTempEditedDictionaryGroupName] = useState<string>('');


  const [showLoadModal, setShowLoadModal] = useState<boolean>(false);
  const [showDictionaryModal, setShowDictionaryModal] = useState<boolean>(false);
  const [showAddWordModal, setShowAddWordModal] = useState<boolean>(false);
  const [newWordEnglish, setNewWordEnglish] = useState<string>('');
  const [newWordJapanese, setNewWordJapanese] = useState<string>('');
  const [bulkWordsInput, setBulkWordsInput] = useState<string>('');

  const [showSelectFromDictionaryModal, setShowSelectFromDictionaryModal] = useState<boolean>(false);
  const [currentPairIdForDictionary, setCurrentPairIdForDictionary] = useState<string | null>(null);
  const [selectedDictionaryEntries, setSelectedDictionaryEntries] = useState<Set<string>>(new Set());
  const [expandedDictionaryGroups, setExpandedDictionaryGroups] = useState<Set<string>>(new Set());

  const [selectedDictionaryEntriesForDeletion, setSelectedDictionaryEntriesForDeletion] = useState<Set<string>>(new Set());
  const [expandedUserDictionaryGroups, setExpandedUserDictionaryGroups] = useState<Set<string>>(new Set());
  const [selectedGroupsForDeletion, setSelectedGroupsForDeletion] = useState<Set<string>>(new Set());

  const [showChangeGroupModal, setShowChangeGroupModal] = useState<boolean>(false);
  const [wordToChangeGroup, setWordToChangeGroup] = useState<UserDictionaryEntry | null>(null);
  const [selectedNewGroup, setSelectedNewGroup] = useState<string>('未分類');
  const [selectedEntriesForGroupChange, setSelectedEntriesForGroupChange] = useState<Set<string>>(new Set());

  const [deeplInputText, setDeeplInputText] = useState<string>('');
  const [deeplOutputText, setDeeplOutputText] = useState<string>('');
  const [deeplIsLoading, setDeeplIsLoading] = useState<boolean>(false);

  // 辞書検索用のState
  const [dictionarySearchQuery, setDictionarySearchQuery] = useState<string>('');
  // 編集中の単語IDと編集値のState
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editingEnglish, setEditingEnglish] = useState<string>('');
  const [editingJapanese, setEditingJapanese] = useState<string>('');
  // 翻訳ペアの名前編集用
  const [editingPairNameId, setEditingPairNameId] = useState<string | null>(null);
  const [tempPairName, setTempPairName] = useState<string>('');


  // DeepL翻訳機の入力テキストエリアのref
  const deeplInputRef = useRef<HTMLTextAreaElement>(null);


  const [currentUser, setCurrentUser] = useState<firebaseAuth.User | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isAuthReady, setIsAuthReady] = useState<boolean>(false);

  const [db, setDb] = useState<firestore.Firestore | null>(null);
  const [auth, setAuth] = useState<firebaseAuth.Auth | null>(null);

  const inputDebounceTimers = useRef<{ [key: string]: NodeJS.Timeout }>({});
  const outputDebounceTimers = useRef<{ [key: string]: NodeJS.Timeout }>({});
  const deeplDebounceTimer = useRef<NodeJS.Timeout | null>(null);


  const detectJapanese = useCallback((text: string): boolean => {
    const japaneseCharRegex = /[\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uFF00-\uFFEF]/;
    return japaneseCharRegex.test(text);
  }, []);

  useEffect(() => {
    let currentApp: firebaseApp.FirebaseApp;
    try {
      if (!firebaseApp.getApps().length) {
        const firebaseConfig = {
          apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
          authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
          projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
          storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
          messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
          appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
          measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
        };
        currentApp = firebaseApp.initializeApp(firebaseConfig);
      } else {
        currentApp = firebaseApp.getApp();
      }
      setDb(firestore.getFirestore(currentApp));
      setAuth(firebaseAuth.getAuth(currentApp));
    } catch (error) {
      console.error("Firebase initialization failed:", error);
      setIsAuthReady(true);
    }
  }, []);

  useEffect(() => {
    if (!auth) return;
    const unsubscribe = firebaseAuth.onAuthStateChanged(auth, async (user) => {
      if (user) {
        setCurrentUser(user);
        setUserId(user.uid);
        setIsAuthReady(true);
      } else {
        try {
          if (typeof window !== 'undefined' && (window as any).__initial_auth_token) {
            await firebaseAuth.signInWithCustomToken(auth, (window as any).__initial_auth_token);
          } else {
            await firebaseAuth.signInAnonymously(auth);
          }
          setCurrentUser(auth.currentUser);
          setUserId(auth.currentUser?.uid || null);
        } catch (error: any) {
          console.error("Firebase sign-in failed:", error.code, error.message);
          setUserId(null);
        } finally {
          setIsAuthReady(true);
        }
      }
    });
    return () => unsubscribe();
  }, [auth]);

  const signInWithGoogle = useCallback(async () => {
    if (!auth) return;
    const provider = new firebaseAuth.GoogleAuthProvider();
    try {
      await firebaseAuth.signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error("Google sign-in failed:", error.code, error.message);
      alert(`Googleログインに失敗しました: ${error.message || '不明なエラー'}`);
    }
  }, [auth]);

  const signOutUser = useCallback(async () => {
    if (!auth) return;
    try {
      await firebaseAuth.signOut(auth);
      await firebaseAuth.signInAnonymously(auth);
    } catch (error: any) {
      console.error("Sign-out failed:", error.code, error.message);
      alert(`ログアウトに失敗しました: ${error.message || '不明なエラー'}`);
    }
  }, [auth]);


  const fetchSavedPrompts = useCallback(async () => {
    if (!db || !userId || !isAuthReady) return;
    try {
      const appId = (window as any).__app_id || 'default-app-id';
      const promptsCollectionRef = firestore.collection(db, `artifacts/${appId}/users/${userId}/prompts`);
      const q = firestore.query(promptsCollectionRef);
      const querySnapshot = await firestore.getDocs(q);
      const prompts: SavedPrompt[] = [];
      const groups: Set<string> = new Set(['未分類']);
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data() as Omit<SavedPrompt, 'id'>;
        prompts.push({ id: docSnap.id, ...data });
        if(data.group) groups.add(data.group);
      });
      prompts.sort((a, b) => b.timestamp.toDate().getTime() - a.timestamp.toDate().getTime());
      setSavedPrompts(prompts);
      setAvailableGroups(prev => Array.from(new Set([...prev, ...groups])).sort());
    } catch (error) {
      console.error("Error fetching saved prompts:", error);
    }
  }, [db, userId, isAuthReady, setSavedPrompts, setAvailableGroups]);

  const fetchSavedPromptSets = useCallback(async () => {
    if (!db || !userId || !isAuthReady) return;
    try {
      const appId = (window as any).__app_id || 'default-app-id';
      const promptSetsCollectionRef = firestore.collection(db, `artifacts/${appId}/users/${userId}/promptSets`);
      const q = firestore.query(promptSetsCollectionRef);
      const querySnapshot = await firestore.getDocs(q);
      const sets: SavedPromptSet[] = [];
      const groups: Set<string> = new Set(['未分類']);
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data() as Omit<SavedPromptSet, 'id'>;
        sets.push({ id: docSnap.id, ...data });
        if(data.group) groups.add(data.group);
      });
      sets.sort((a, b) => b.timestamp.toDate().getTime() - a.timestamp.toDate().getTime());
      setSavedPromptSets(sets);
      setAvailableGroups(prev => Array.from(new Set([...prev, ...groups])).sort());
    } catch (error) {
      console.error("Error fetching saved prompt sets:", error);
    }
  }, [db, userId, isAuthReady, setSavedPromptSets, setAvailableGroups]);

  const fetchUserDictionary = useCallback(async () => {
    if (!db || !userId || !isAuthReady) return;
    try {
      const appId = (window as any).__app_id || 'default-app-id';
      const dictionaryCollectionRef = firestore.collection(db, `artifacts/${appId}/users/${userId}/userDictionary`);
      const q = firestore.query(dictionaryCollectionRef, firestore.orderBy('timestamp', 'desc'));
      const querySnapshot = await firestore.getDocs(q);
      const entries: UserDictionaryEntry[] = [];
      const groups: Set<string> = new Set(['未分類']);
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data() as Omit<UserDictionaryEntry, 'id'>;
        entries.push({ id: docSnap.id, ...data });
        if(data.group) groups.add(data.group);
      });
      setUserDictionary(entries);
      setAvailableDictionaryGroups(Array.from(groups).sort());
      setExpandedDictionaryGroups(new Set()); // 「辞書から追加」用
      setExpandedUserDictionaryGroups(new Set()); // 「ユーザー辞書」管理用
    } catch (error) {
      console.error("Error fetching user dictionary:", error);
    }
  }, [db, userId, isAuthReady, setUserDictionary, setAvailableDictionaryGroups, setExpandedDictionaryGroups, setExpandedUserDictionaryGroups]);

  useEffect(() => {
    const loadAllUserData = async () => {
      if (isAuthReady && db && userId) {
        await fetchSavedPrompts();
        await fetchSavedPromptSets();
        await fetchUserDictionary();
      } else if (isAuthReady && db && !userId) {
        setSavedPrompts([]);
        setSavedPromptSets([]);
        setUserDictionary([]);
        setAvailableGroups(['未分類']);
        setAvailableDictionaryGroups(['未分類']);
      }
    };
    void loadAllUserData();
  }, [userId, db, isAuthReady, fetchSavedPrompts, fetchSavedPromptSets, fetchUserDictionary, setSavedPrompts, setSavedPromptSets, setUserDictionary, setAvailableGroups, setAvailableDictionaryGroups]);

  const translateText = useCallback(async (text: string, targetLang: 'en' | 'ja', pairId: string): Promise<string> => {
    setTranslationPairs(prev => prev.map(p => p.id === pairId ? { ...p, isLoading: true } : p));
    try {
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: [text], target_lang: targetLang }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'DeepL API translation failed');
      return data.translatedText;
    } catch (error: any) {
      console.error(`[translateText] Error for Pair ID ${pairId}:`, error);
      return `翻訳エラー: ${error.message}`;
    } finally {
      setTranslationPairs(prev => prev.map(p => p.id === pairId ? { ...p, isLoading: false } : p));
    }
  }, [setTranslationPairs]);

  const translateDeepLOnly = useCallback(async (text: string, targetLang: 'en' | 'ja'): Promise<string> => {
    setDeeplIsLoading(true);
    try {
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: [text], target_lang: targetLang }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'DeepL API translation failed');
      return data.translatedText;
    } catch (error: any) {
      console.error(`[translateDeepLOnly] Error:`, error);
      return `翻訳エラー: ${error.message}`;
    } finally {
      setDeeplIsLoading(false);
    }
  }, []);

  const copyToClipboard = useCallback((text: string) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(err => console.error('Failed to copy: ', err));
    } else {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
      } catch (err) {
        console.error('Failed to copy: ', err);
      }
      document.body.removeChild(textArea);
    }
  }, []);

  // ★変更点: 入力テキストから無効化単語を処理するヘルパー関数
  // "-単語" の形式の単語を削除
  const processInputTextForTranslation = useCallback((text: string): string => {
    // 単語の先頭にハイフンがあり、その後に単語境界がある形式（例: -boy, -girl）
    // この正規表現は、単語の前にハイフンがある場合にその単語をマッチさせます。
    // その後、カンマとスペースを整理します。
    const regex = /-\b(\w+)\b/g;
    return text.replace(regex, '').trim().replace(/,(\s*,)*/g, ', ').replace(/,$/, ''); // 連続するカンマや末尾のカンマを整理
  }, []);

  const handleInputTextChange = useCallback((pairId: string, newInputValue: string) => {
    setTranslationPairs(prev => prev.map(p => p.id === pairId ? { ...p, inputText: newInputValue, isUserEditingOutput: false } : p));
    if (inputDebounceTimers.current[pairId]) clearTimeout(inputDebounceTimers.current[pairId]);
    if (newInputValue.trim() === '') {
      setTranslationPairs(prev => prev.map(p => p.id === pairId ? { ...p, outputText: '' } : p));
      return;
    }
    inputDebounceTimers.current[pairId] = setTimeout(async () => {
      // DeepLに送る前に無効化単語を処理
      const textToSendToDeepL = processInputTextForTranslation(newInputValue);
      let translated = await translateText(textToSendToDeepL, 'ja', pairId);
      userDictionary.forEach((entry: UserDictionaryEntry) => {
        const regex = new RegExp(`\\b${entry.english.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
        translated = translated.replace(regex, entry.japanese);
      });
      setTranslationPairs(prev => prev.map(p => p.id === pairId ? { ...p, outputText: translated } : p));
    }, 300);
  }, [setTranslationPairs, translateText, userDictionary, inputDebounceTimers, processInputTextForTranslation]); // 依存配列に追加

  const handleOutputTextChange = useCallback((pairId: string, newOutputValue: string) => {
    setTranslationPairs(prev => prev.map(p => p.id === pairId ? { ...p, outputText: newOutputValue, isUserEditingOutput: true } : p));
    if (outputDebounceTimers.current[pairId]) clearTimeout(outputDebounceTimers.current[pairId]);
    if (newOutputValue.trim() === '') {
      setTranslationPairs(prev => prev.map(p => p.id === pairId ? { ...p, inputText: '' } : p));
      return;
    }
    outputDebounceTimers.current[pairId] = setTimeout(async () => {
      let translatedBack = await translateText(newOutputValue, 'en', pairId);
      userDictionary.forEach((entry: UserDictionaryEntry) => {
        const regex = new RegExp(`\\b${entry.japanese.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
        translatedBack = translatedBack.replace(regex, entry.english);
      });
      setTranslationPairs(prev => prev.map(p => p.id === pairId ? { ...p, inputText: translatedBack, isUserEditingOutput: false } : p));
    }, 500);
  }, [setTranslationPairs, translateText, userDictionary, outputDebounceTimers]);

  const handleDeeplInputTextChange = useCallback((newInputValue: string) => {
    setDeeplInputText(newInputValue);
    if (deeplDebounceTimer.current) clearTimeout(deeplDebounceTimer.current);
    if (newInputValue.trim() === '') {
      setDeeplOutputText('');
      return;
    }
    deeplDebounceTimer.current = setTimeout(async () => {
      const isJapanese = detectJapanese(newInputValue);
      const targetLang = isJapanese ? 'en' : 'ja';
      const translated = await translateDeepLOnly(processInputTextForTranslation(newInputValue), targetLang); // DeepLに送る前に無効化単語を処理
      setDeeplOutputText(translated);
    }, 300); // 翻訳のデバウンス時間
  }, [detectJapanese, translateDeepLOnly, processInputTextForTranslation]); // 依存配列に追加


  useEffect(() => {
    const timers = { ...inputDebounceTimers.current, ...outputDebounceTimers.current };
    if (deeplDebounceTimer.current) {
      Object.values(timers).forEach(clearTimeout);
      clearTimeout(deeplDebounceTimer.current);
    }
    return () => {
      Object.values(timers).forEach(clearTimeout);
      if (deeplDebounceTimer.current) clearTimeout(deeplDebounceTimer.current);
    };
  }, []);

  const addTranslationPair = useCallback(() => {
    setTranslationPairs(prev => {
      // 新しい翻訳ペアの名前を生成
      const newPairCount = prev.length + 1;
      const newColor = colorPalette[prev.length % colorPalette.length];
      return [
        ...prev,
        {
          id: crypto.randomUUID(),
          name: `翻訳ペア ${newPairCount}`,
          inputText: '',
          outputText: '',
          isJapaneseInput: false,
          isLoading: false,
          isUserEditingOutput: false,
          color: newColor,
          isDisabled: false, // 新しいペアは有効
        },
      ];
    });
  }, [setTranslationPairs]);

  const deleteTranslationPair = useCallback((idToDelete: string) => {
    setTranslationPairs(prev => prev.filter((p: TranslationPair) => p.id !== idToDelete));
  }, [setTranslationPairs]);

  const moveTranslationPair = useCallback((currentIndex: number, targetIndex: number) => {
    setTranslationPairs(prev => {
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const newPairs = [...prev];
      const [movedPair] = newPairs.splice(currentIndex, 1);
      newPairs.splice(targetIndex, 0, movedPair);
      return newPairs;
    });
  }, [setTranslationPairs]);

  // ★追加: 翻訳ペアの有効/無効を切り替える関数
  const togglePairDisabled = useCallback((pairId: string) => {
    setTranslationPairs(prev => prev.map(p =>
      p.id === pairId ? { ...p, isDisabled: !p.isDisabled } : p
    ));
  }, [setTranslationPairs]);

  const [individualPromptToSave, setIndividualPromptToSave] = useState<TranslationPair | null>(null);
  const [saveModalType, setSaveModalType] = useState<'individual' | 'session'>('individual');

  const handleSaveIndividualPrompt = useCallback((pair: TranslationPair) => {
    setIndividualPromptToSave(pair);
    setSaveModalType('individual');
    setSaveName(pair.inputText.substring(0, 30) || '新規プロンプト');
    setShowSaveModal(true);
  }, [setIndividualPromptToSave, setSaveModalType, setSaveName, setShowSaveModal]);

  const handleSaveSessionPrompts = useCallback(() => {
    setIndividualPromptToSave(null);
    setSaveModalType('session');
    setSaveName('新規セッション');
    setShowSaveModal(true);
  }, [setIndividualPromptToSave, setSaveModalType, setSaveName, setShowSaveModal]);

  const confirmSave = useCallback(async () => {
    if (!db || !userId || !saveName.trim()) {
      alert("保存名を入力してください。");
      return;
    }
    const newGroup = saveGroup.trim() || '未分類';
    const appId = (window as any).__app_id || 'default-app-id';
    try {
      if (saveModalType === 'individual' && individualPromptToSave) {
        const collectionRef = firestore.collection(db, `artifacts/${appId}/users/${userId}/prompts`);
        await firestore.addDoc(collectionRef, {
          name: saveName.trim(),
          group: newGroup,
          inputText: individualPromptToSave.inputText,
          outputText: individualPromptToSave.outputText,
          isJapaneseInput: individualPromptToSave.isJapaneseInput,
          color: individualPromptToSave.color,
          timestamp: firestore.Timestamp.now(),
        });
        fetchSavedPrompts();
        alert('プロンプトが保存されました！');
      } else if (saveModalType === 'session') {
        const collectionRef = firestore.collection(db, `artifacts/${appId}/users/${userId}/promptSets`);
        const pairsToSave = translationPairs.map((p: TranslationPair) => ({
          inputText: p.inputText,
          outputText: p.outputText,
          isJapaneseInput: p.isJapaneseInput,
          color: p.color,
        }));
        await firestore.addDoc(collectionRef, {
          name: saveName.trim(),
          group: newGroup,
          pairs: pairsToSave,
          timestamp: firestore.Timestamp.now(),
        });
        fetchSavedPromptSets();
        alert('セッションが保存されました！');
      }
      setShowSaveModal(false);
      setSaveName('');
      setSaveGroup('未分類');
    } catch (error: any) {
      console.error("Error saving:", error);
      alert(`保存に失敗しました: ${error.message || '不明なエラー'}`);
    }
  }, [db, userId, saveName, saveGroup, saveModalType, individualPromptToSave, translationPairs, fetchSavedPrompts, fetchSavedPromptSets, setShowSaveModal, setSaveName, setSaveGroup]);

  const closeSaveModal = useCallback(() => setShowSaveModal(false), [setShowSaveModal]);

  const handleLoadIndividualPrompt = useCallback((prompt: SavedPrompt) => {
    addTranslationPair();
    setTranslationPairs(prev => prev.map((p, index) => index === prev.length - 1 ? {
      ...p,
      inputText: prompt.inputText,
      outputText: prompt.outputText,
      isJapaneseInput: prompt.isJapaneseInput,
      color: prompt.color || colorPalette[(prev.length - 1) % colorPalette.length],
    } : p));
    setShowLoadModal(false);
  }, [addTranslationPair, setTranslationPairs, setShowLoadModal]);

  const handleLoadPromptSet = useCallback((promptSet: SavedPromptSet) => {
    const loadedPairs = promptSet.pairs.map((p, index) => ({
      id: crypto.randomUUID(),
      ...p,
      isLoading: false,
      isUserEditingOutput: false,
      color: p.color || colorPalette[index % colorPalette.length],
    }));
    setTranslationPairs(loadedPairs);
    setShowLoadModal(false);
  }, [setTranslationPairs, setShowLoadModal]);

  const handleDeleteSavedPrompt = useCallback(async (promptId: string) => {
    if (!db || !userId) {
      alert("ユーザーが認証されていません。");
      return;
    }
    if (!confirm('このプロンプトを削除してもよろしいですか？')) return;
    const appId = (window as any).__app_id || 'default-app-id';
    try {
      const docRef = firestore.doc(db, `artifacts/${appId}/users/${userId}/prompts`, promptId);
      await firestore.deleteDoc(docRef);
      fetchSavedPrompts();
      alert('プロンプトが削除されました。');
    } catch (error: any) {
      console.error("Error deleting prompt:", error);
      alert(`プロンプトの削除に失敗しました: ${error.message || '不明なエラー'}`);
    }
  }, [db, userId, fetchSavedPrompts]);

  const handleDeleteSavedPromptSet = useCallback(async (promptSetId: string) => {
    if (!db || !userId) {
      alert("ユーザーが認証されていません。");
      return;
    }
    if (!confirm('このセッションを削除してもよろしいですか？')) return;
    const appId = (window as any).__app_id || 'default-app-id';
    try {
      const docRef = firestore.doc(db, `artifacts/${appId}/users/${userId}/promptSets`, promptSetId);
      await firestore.deleteDoc(docRef);
      fetchSavedPromptSets();
      alert('セッションが削除されました。');
    } catch (error: any) {
      console.error("Error deleting prompt set:", error);
      alert(`セッションの削除に失敗しました: ${error.message || '不明なエラー'}`);
    }
  }, [db, userId, fetchSavedPromptSets]);

  const updateDictionaryGroupName = useCallback(async () => {
    if (!db || !userId || !editDictionaryGroupName || !tempEditedDictionaryGroupName.trim()) {
      alert("グループ名が指定されていないか、変更するグループが選択されていません。");
      return;
    }
    if (editDictionaryGroupName === tempEditedDictionaryGroupName.trim()) {
      alert("変更後のグループ名が既存のグループ名と同じです。");
      setEditDictionaryGroupName(null); // 編集モード終了
      setTempEditedDictionaryGroupName('');
      return;
    }
    if (availableDictionaryGroups.includes(tempEditedDictionaryGroupName.trim())) {
      alert("変更後のグループ名が既存の別のグループ名と重複しています。");
      return;
    }

    if (!confirm(`「${editDictionaryGroupName}」を「${tempEditedDictionaryGroupName.trim()}」に変更してもよろしいですか？\nこのグループに属する全ての単語のグループも変更されます。`)) {
      return;
    }

    const appId = (window as any).__app_id || 'default-app-id';
    try {
      const batch = firestore.writeBatch(db);
      userDictionary.filter(entry => (entry.group || '未分類') === editDictionaryGroupName).forEach(entry => {
        const docRef = firestore.doc(db, `artifacts/${appId}/users/${userId}/userDictionary`, entry.id);
        batch.update(docRef, { group: tempEditedDictionaryGroupName.trim() });
      });
      await batch.commit();
      fetchUserDictionary();
      alert(`グループ名が「${editDictionaryGroupName}」から「${tempEditedDictionaryGroupName.trim()}」に変更されました。`);
      setEditDictionaryGroupName(null); // 編集モード終了
      setTempEditedDictionaryGroupName('');
    } catch (error: any) {
      console.error("Error updating dictionary group name:", error);
      alert(`グループ名の変更に失敗しました: ${error.message || '不明なエラー'}`);
    }
  }, [db, userId, editDictionaryGroupName, tempEditedDictionaryGroupName, availableDictionaryGroups, userDictionary, fetchUserDictionary]);


  const addSingleWordToDictionary = useCallback(async () => {
    if (!db || !userId) {
      alert("ユーザーが認証されていません。");
      return;
    }
    if (!newWordEnglish.trim() || !newWordJapanese.trim()) {
      alert("英語と日本語の両方を入力してください。");
      return;
    }
    const newDictionaryGroup = dictionaryWordGroup.trim() || '未分類';
    const appId = (window as any).__app_id || 'default-app-id';
    try {
      await firestore.addDoc(firestore.collection(db, `artifacts/${appId}/users/${userId}/userDictionary`), {
        english: newWordEnglish.trim(),
        japanese: newWordJapanese.trim(),
        group: newDictionaryGroup,
        timestamp: firestore.Timestamp.now(),
      });
      setNewWordEnglish('');
      setNewWordJapanese('');
      fetchUserDictionary();
    } catch (error: any) {
      console.error("Error adding word to dictionary:", error);
      alert(`単語の登録に失敗しました: ${error.message || '不明なエラー'}`);
    }
  }, [db, userId, newWordEnglish, newWordJapanese, dictionaryWordGroup, fetchUserDictionary, setNewWordEnglish, setNewWordJapanese]);

  const addBulkWordsToDictionary = useCallback(async () => {
    if (!db || !userId) {
      alert("ユーザーが認証されていません。");
      return;
    }
    if (!bulkWordsInput.trim()) {
      alert("入力が空です。単語ペアを入力してください。");
      return;
    }
    const newDictionaryGroup = dictionaryWordGroup.trim() || '未分類';
    const appId = (window as any).__app_id || 'default-app-id';
    const lines = bulkWordsInput.trim().split('\n');
    const newEntries: Omit<UserDictionaryEntry, 'id' | 'timestamp'>[] = [];
    let successCount = 0;

    for (const line of lines) {
      const parts = line.split(',');
      if (parts.length >= 2) {
        const english = parts[0].trim();
        const japanese = parts[1].trim();
        if (english && japanese) {
          newEntries.push({ english, japanese, group: newDictionaryGroup });
        }
      }
    }

    if (newEntries.length === 0) {
      alert('有効な単語ペアが見つかりませんでした。各行が「英語,日本語」の形式であることを確認してください。');
      return;
    }

    try {
      const collectionRef = firestore.collection(db, `artifacts/${appId}/users/${userId}/userDictionary`);
      const batch = firestore.writeBatch(db);
      newEntries.forEach(entry => {
        const docRef = firestore.doc(collectionRef);
        batch.set(docRef, { ...entry, timestamp: firestore.Timestamp.now() });
        successCount++;
      });
      await batch.commit();
      setBulkWordsInput('');
      fetchUserDictionary();
    } catch (error: any) {
      console.error("Error adding bulk words to dictionary:", error);
      alert(`単語の一括登録に失敗しました: ${error.message || '不明なエラー'}`);
    }
  }, [db, userId, bulkWordsInput, dictionaryWordGroup, fetchUserDictionary, setBulkWordsInput]);

  // 修正: deleteDictionaryEntries の引数を Set<string> に変更
  // 削除後にモーダルが閉じないように `setShowSelectFromDictionaryModal(false)` を削除
  const deleteDictionaryEntries = useCallback(async (entryIdsToDelete: Set<string>) => {
    if (!db || !userId) {
      alert("ユーザーが認証されていません。");
      return;
    }
    if (entryIdsToDelete.size === 0) {
      alert("削除する単語を選択してください。");
      return;
    }
    // 確認アラートは削除済み

    const appId = (window as any).__app_id || 'default-app-id';
    try {
      const batch = firestore.writeBatch(db);
      entryIdsToDelete.forEach(entryId => {
        const docRef = firestore.doc(db, `artifacts/${appId}/users/${userId}/userDictionary`, entryId);
        batch.delete(docRef);
      });
      await batch.commit();
      setSelectedDictionaryEntriesForDeletion(new Set()); // 選択状態をクリア
      // Stateを直接更新してFirestoreへの再取得を回避し、モーダルを閉じない
      setUserDictionary(prev => prev.filter(entry => !entryIdsToDelete.has(entry.id)));
    } catch (error: any) {
      console.error("Error deleting dictionary entries:", error);
      alert(`単語の削除に失敗しました: ${error.message || '不明なエラー'}`);
    }
  }, [db, userId, setUserDictionary, setSelectedDictionaryEntriesForDeletion]);

  const deleteDictionaryGroups = useCallback(async () => {
    if (!db || !userId) {
      alert("ユーザーが認証されていません。");
      return;
    }
    if (selectedGroupsForDeletion.size === 0) {
      alert("削除するグループを選択してください。");
      return;
    }
    if (!confirm(`${Array.from(selectedGroupsForDeletion).join(', ')} グループを削除してもよろしいですか？\nこれらのグループに属する全ての単語も削除されます。`)) return;

    const appId = (window as any).__app_id || 'default-app-id';
    try {
      const batch = firestore.writeBatch(db);
      let deletedWordCount = 0;

      selectedGroupsForDeletion.forEach(groupToDelete => {
        userDictionary.filter(entry => (entry.group || '未分類') === groupToDelete).forEach(entry => {
          const docRef = firestore.doc(db, `artifacts/${appId}/users/${userId}/userDictionary`, entry.id);
          batch.delete(docRef);
          deletedWordCount++;
        });
      });

      await batch.commit();
      setSelectedGroupsForDeletion(new Set());
      setSelectedDictionaryEntriesForDeletion(new Set());
      fetchUserDictionary();
      alert(`${selectedGroupsForDeletion.size} 件のグループと ${deletedWordCount} 件の単語が削除されました。`);
    } catch (error: any) {
      console.error("Error deleting dictionary groups:", error);
      alert(`グループの削除に失敗しました: ${error.message || '不明なエラー'}`);
    }
  }, [db, userId, selectedGroupsForDeletion, userDictionary, fetchUserDictionary, setSelectedGroupsForDeletion, setSelectedDictionaryEntriesForDeletion]);


  const handleOpenSelectFromDictionary = useCallback((pairId: string) => {
    setCurrentPairIdForDictionary(pairId);
    setSelectedDictionaryEntries(new Set());
    setExpandedDictionaryGroups(new Set()); // モーダルを開くときに全グループを閉じる
    setDictionarySearchQuery(''); // 検索クエリをリセット
    setEditingEntryId(null); // 編集モードをリセット
    setShowSelectFromDictionaryModal(true);
  }, [setCurrentPairIdForDictionary, setSelectedDictionaryEntries, setShowSelectFromDictionaryModal, setExpandedDictionaryGroups, setDictionarySearchQuery, setEditingEntryId]);

  const handleToggleDictionaryEntrySelection = useCallback((entryId: string) => {
    setSelectedDictionaryEntries(prev => {
      const newSelection = new Set(prev);
      if (newSelection.has(entryId)) {
        newSelection.delete(entryId);
      } else {
        newSelection.add(entryId);
      }
      return newSelection;
    });
  }, [setSelectedDictionaryEntries]);

  const handleToggleDictionaryEntrySelectionForDeletion = useCallback((entryId: string) => {
    setSelectedDictionaryEntriesForDeletion(prev => {
      const newSelection = new Set(prev);
      if (newSelection.has(entryId)) {
        newSelection.delete(entryId);
      } else {
        newSelection.add(entryId);
      }
      return newSelection;
    });
  }, [setSelectedDictionaryEntriesForDeletion]);

  const toggleSelectAllForGroupForDeletion = useCallback((groupName: string, selectAll: boolean) => {
    setSelectedDictionaryEntriesForDeletion(prev => {
      const newSelection = new Set(prev);
      userDictionary.filter(entry => (entry.group || '未分類') === groupName).forEach(entry => {
        if (selectAll) {
          newSelection.add(entry.id);
        } else {
          newSelection.delete(entry.id);
        }
      });
      return newSelection;
    });
  }, [userDictionary, setSelectedDictionaryEntriesForDeletion]);

  const toggleSelectAllForGroupForAdd = useCallback((groupName: string, selectAll: boolean) => {
    setSelectedDictionaryEntries(prev => {
      const newSelection = new Set(prev);
      userDictionary.filter(entry => (entry.group || '未分類') === groupName).forEach(entry => {
        if (selectAll) {
          newSelection.add(entry.id);
        } else {
          newSelection.delete(entry.id);
        }
      });
      return newSelection;
    });
  }, [userDictionary, setSelectedDictionaryEntries]);


  const handleToggleGroupSelectionForDeletion = useCallback((groupName: string) => {
    setSelectedGroupsForDeletion(prev => {
      const newSelection = new Set(prev);
      if (newSelection.has(groupName)) {
        newSelection.delete(groupName);
      } else {
        newSelection.add(groupName);
      }
      return newSelection;
    });
  }, [setSelectedGroupsForDeletion]);

  const handleAddSelectedDictionaryEntriesToPair = useCallback(() => {
    if (!currentPairIdForDictionary || selectedDictionaryEntries.size === 0) {
      alert("追加する単語を選択してください。");
      return;
    }

    const pairToUpdate = translationPairs.find((p: TranslationPair) => p.id === currentPairIdForDictionary);
    if (!pairToUpdate) return;

    let newEnglishText = pairToUpdate.inputText.trim();
    let newJapaneseText = pairToUpdate.outputText.trim();

    userDictionary.forEach((entry: UserDictionaryEntry) => {
      if (selectedDictionaryEntries.has(entry.id)) {
        if (newEnglishText === '') {
          newEnglishText = entry.english;
        } else {
          if (!newEnglishText.endsWith(',') && !newEnglishText.endsWith(', ')) {
            newEnglishText += ', ';
          } else if (newEnglishText.endsWith(',')) {
            newEnglishText += ' ';
          }
          newEnglishText += entry.english;
        }

        if (newJapaneseText === '') {
          newJapaneseText = entry.japanese;
        } else {
          if (!newJapaneseText.endsWith('、') && !newJapaneseText.endsWith('。') && !newJapaneseText.endsWith('、 ')) {
              newJapaneseText += '、';
          }
          newJapaneseText += entry.japanese;
        }
      }
    });

    setTranslationPairs(prev => prev.map((p: TranslationPair) =>
      p.id === currentPairIdForDictionary
        ? {
            ...p,
            inputText: newEnglishText,
            outputText: newJapaneseText,
            isUserEditingOutput: true
          }
        : p
    ));

    setShowSelectFromDictionaryModal(false);
    setCurrentPairIdForDictionary(null);
    setSelectedDictionaryEntries(new Set());
  }, [currentPairIdForDictionary, selectedDictionaryEntries, translationPairs, userDictionary, setShowSelectFromDictionaryModal, setCurrentPairIdForDictionary, setSelectedDictionaryEntries, setTranslationPairs]);

  const toggleExpandedDictionaryGroup = useCallback((groupName: string) => {
    setExpandedDictionaryGroups(prev => {
      const newSet = new Set(prev);
      if (newSet.has(groupName)) {
        newSet.delete(groupName);
      } else {
        newSet.add(groupName);
      }
      return newSet;
    });
  }, [setExpandedDictionaryGroups]);

  const toggleExpandedUserDictionaryGroup = useCallback((groupName: string) => {
    setExpandedUserDictionaryGroups(prev => {
      const newSet = new Set(prev);
      if (newSet.has(groupName)) {
        newSet.delete(groupName);
      } else {
        newSet.add(groupName);
      }
      return newSet;
    });
  }, [setExpandedUserDictionaryGroups]);

  const openChangeGroupModal = useCallback((entry?: UserDictionaryEntry) => {
    if (entry) {
      setWordToChangeGroup(entry);
      setSelectedEntriesForGroupChange(new Set([entry.id]));
      setSelectedNewGroup(entry.group || '未分類');
    } else if (selectedDictionaryEntriesForDeletion.size > 0) {
      setWordToChangeGroup(null);
      setSelectedEntriesForGroupChange(new Set(Array.from(selectedDictionaryEntriesForDeletion)));
      const commonGroup = Array.from(selectedDictionaryEntriesForDeletion)
        .map(id => userDictionary.find(entry => entry.id === id)?.group || '未分類')
        .reduce((acc, group, idx, arr) => (idx === 0 || acc === group ? group : ''), '');
      setSelectedNewGroup(commonGroup || '未分類');
    } else {
      alert("グループを変更する単語を選択してください。");
      return;
    }
    setShowChangeGroupModal(true);
  }, [selectedDictionaryEntriesForDeletion, userDictionary, setWordToChangeGroup, setSelectedEntriesForGroupChange, setSelectedNewGroup, setShowChangeGroupModal]);


  const confirmChangeGroup = useCallback(async () => {
    if (!db || !userId || selectedEntriesForGroupChange.size === 0 || !selectedNewGroup.trim()) {
      alert("エラーが発生しました。または変更する単語が選択されていません。");
      return;
    }
    const appId = (window as any).__app_id || 'default-app-id';
    try {
      const batch = firestore.writeBatch(db);
      let changedCount = 0;
      selectedEntriesForGroupChange.forEach(entryId => {
        const docRef = firestore.doc(db, `artifacts/${appId}/users/${userId}/userDictionary`, entryId);
        batch.update(docRef, { group: selectedNewGroup.trim() });
        changedCount++;
      });
      await batch.commit();
      fetchUserDictionary();
      alert(`${changedCount} 件の単語のグループが「${selectedNewGroup.trim()}」に変更されました。`);
      setShowChangeGroupModal(false);
      setWordToChangeGroup(null);
      setSelectedNewGroup('未分類');
      setSelectedEntriesForGroupChange(new Set()); // 選択状態をクリア
      setSelectedDictionaryEntriesForDeletion(new Set()); // 削除用選択状態もクリア
    } catch (error: any) {
      console.error("Error changing word group:", error);
      alert(`グループ変更に失敗しました: ${error.message || '不明なエラー'}`);
    }
  }, [db, userId, selectedEntriesForGroupChange, selectedNewGroup, fetchUserDictionary, setShowChangeGroupModal, setWordToChangeGroup, setSelectedNewGroup, setSelectedEntriesForGroupChange, setSelectedDictionaryEntriesForDeletion]);

  const handleSingleWordKeyPress = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addSingleWordToDictionary();
    }
  }, [addSingleWordToDictionary]);

  const handleBulkWordsKeyPress = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && e.shiftKey) {
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      addBulkWordsToDictionary();
    }
  }, [addBulkWordsToDictionary]);

  // 翻訳ペアの名前変更ハンドラ
  const handlePairNameChange = useCallback((pairId: string, newName: string) => {
    setTranslationPairs(prev => prev.map(p =>
      p.id === pairId ? { ...p, name: newName } : p
    ));
  }, [setTranslationPairs]);

  // 翻訳ペアの名前編集モードに入る
  const handleDoubleClickPairName = useCallback((pair: TranslationPair) => {
    setEditingPairNameId(pair.id);
    setTempPairName(pair.name);
  }, []);

  // 翻訳ペアの名前編集を保存
  const handleSavePairName = useCallback((pairId: string) => {
    if (tempPairName.trim() === '') {
      // 空の場合は元の名前に戻すか、デフォルト名にする
      setTranslationPairs(prev => prev.map(p => {
        const originalIndex = translationPairs.findIndex(tp => tp.id === pairId);
        return p.id === pairId ? { ...p, name: `翻訳ペア ${originalIndex + 1}` } : p;
      }));
    } else {
      handlePairNameChange(pairId, tempPairName.trim());
    }
    setEditingPairNameId(null);
    setTempPairName('');
  }, [handlePairNameChange, tempPairName, translationPairs]);


  const plainCombinedEnglishPrompts = useMemo(() => {
    // 無効化された単語 ("-単語" 形式) は、結合プロンプトの「表示」では維持し、
    // 実際に画像生成APIに送る「値」からは除外されるというロジックを反映させる。
    // ここで文字列を結合し、表示上の処理はJSX内で別途行う。
    return translationPairs
      .filter(p => !p.isDisabled) // ★変更点: 無効化された翻訳ペアは結合から除外
      .map((p: TranslationPair) => p.inputText.trim())
      .filter(Boolean) // 空の文字列を除外
      .join(', ');
  }, [translationPairs]);

  // 辞書検索によるフィルタリング
  const filteredUserDictionary = useMemo(() => {
    if (!dictionarySearchQuery) {
      return userDictionary;
    }
    const lowerCaseQuery = dictionarySearchQuery.toLowerCase();
    return userDictionary.filter(entry =>
      entry.english.toLowerCase().includes(lowerCaseQuery) ||
      entry.japanese.toLowerCase().includes(lowerCaseQuery) ||
      (entry.group || '未分類').toLowerCase().includes(lowerCaseQuery)
    );
  }, [userDictionary, dictionarySearchQuery]);

  // フィルタリングされた辞書をグループごとに分類
  const groupedFilteredDictionary = useMemo(() => {
    const groups: { [key: string]: UserDictionaryEntry[] } = {};
    filteredUserDictionary.forEach(entry => {
      const groupName = entry.group || '未分類';
      if (!groups[groupName]) {
        groups[groupName] = [];
      }
      groups[groupName].push(entry);
    });
    // グループ名をソート
    return Object.keys(groups).sort().map(groupName => ({
      groupName,
      entries: groups[groupName].sort((a, b) => a.english.localeCompare(b.english)) // 各グループ内の単語もソート
    }));
  }, [filteredUserDictionary]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 p-4 relative pb-40">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Wand2 className="w-8 h-8 text-purple-300" />
            <h1 className="text-3xl font-bold text-white">AI画像生成プロンプト翻訳</h1>
          </div>
          <p className="text-purple-200">英語入力固定 - 英語プロンプトを日本語に翻訳</p>
        </div>

        {/* DeepL翻訳機 */}
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 shadow-2xl mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Wand2 className="w-6 h-6 text-purple-300" />
            <h2 className="text-xl font-bold text-white">DeepL翻訳機</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="deeplInput" className="text-sm font-medium text-purple-200 block mb-2">入力 (自動言語検出)</label>
              <div className="relative">
                <textarea
                  id="deeplInput"
                  ref={deeplInputRef} // ref を設定
                  value={deeplInputText}
                  onChange={(e) => handleDeeplInputTextChange(e.target.value)}
                  placeholder="ここにテキストを入力..."
                  className="w-full h-24 p-3 bg-white/20 border-2 border-purple-300/30 rounded-xl text-white placeholder-purple-300 resize-none focus:outline-none focus:ring-2 focus:ring-purple-400 transition-colors duration-200"
                  // DeepL翻訳機の入力テキストの色分け機能は削除
                  // style={{ color: 'transparent' }} は削除
                  // onScroll も削除
                />
              </div>
            </div>
            <div>
              <label htmlFor="deeplOutput" className="text-sm font-medium text-purple-200 block mb-2">翻訳結果</label>
              <div className="relative">
                <textarea
                  id="deeplOutput"
                  value={deeplIsLoading ? '翻訳中...' : deeplOutputText}
                  readOnly
                  placeholder="翻訳結果がここに表示されます..."
                  className="w-full h-24 p-3 bg-white/20 border-2 border-purple-300/30 rounded-xl text-white placeholder-purple-300 resize-none focus:outline-none focus:border-purple-400 transition-colors duration-200"
                />
                {deeplIsLoading && (
                  <Loader2 className="animate-spin absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-purple-400" size={24} />
                )}
                {deeplOutputText && !deeplIsLoading && (
                  <button
                    onClick={() => copyToClipboard(deeplOutputText)}
                    className="absolute bottom-2 right-2 p-1 bg-purple-600 hover:bg-purple-700 rounded-lg text-white text-xs transition-colors duration-200"
                    title="翻訳結果をコピー"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>


        <div className="flex justify-end items-center gap-4 mb-6 text-white text-sm">
          {isAuthReady && (
            currentUser ? (
              <div className="flex items-center gap-2 bg-gray-700/50 p-2 rounded-full">
                {currentUser.photoURL && (
                  <img src={currentUser.photoURL} alt="User Avatar" className="w-6 h-6 rounded-full" />
                )}
                <span>{currentUser.displayName || currentUser.email || '匿名ユーザー'}</span>
                {currentUser && !currentUser.isAnonymous && (
                  <button
                    onClick={signOutUser}
                    className="flex items-center gap-1 px-3 py-1 bg-red-600 hover:bg-red-700 rounded-full text-xs font-semibold transition-colors duration-200"
                  >
                    <LogOut className="w-4 h-4" />ログアウト
                  </button>
                )}
              </div>
            ) : (
              <button
                onClick={signInWithGoogle}
                disabled={!auth}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-full shadow-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-white">
                  <path d="M12.24 10.27v2.4H15c-.06 1.17-.66 1.86-1.55 2.51v2.48h2.89c1.78-1.68 2.82-3.88 2.82-7.85 0-.6-.05-1.2-.15-1.77H12.24zm0-3.85h4.86c-.23-1.12-.9-2.02-2.03-2.61v2.33c.69.47 1.25 1.09 1.58 1.88zM12.24 16.57v2.48c-1.12.08-2.18-.32-3.08-1.09l2.79-2.19c.89.26 1.8.41 2.92.41zM5.38 12.01c0-.42.04-.84.1-.25v2.4h-.05L5.19 14c-.81-1.04-1.28-2.31-1.28-3.79s.47-2.75 1.28-3.79L5.38 7.39v2.4c.05.61.09 1.23.11 1.86H5.38zm6.86-8.99c-1.26 0-2.32.22-3.23.65L8.52 6.5C7.9 6.8 7.33 7.32 6.82 8.01L4.04 5.82C5.55 4.3 8.01 3.02 12.24 3.02zM12.24 21.02c-4.23 0-6.7-1.28-8.21-2.79L6.82 18c.51.69 1.08 1.21 1.7 1.52l.49.27c.91.43 1.97.65 3.23.65z" />
                </svg>
                Googleでログイン
              </button>
            )
          )}
        </div>


        <div className="flex justify-start items-center gap-4 mb-6 flex-wrap">
          <button onClick={addTranslationPair} className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-full shadow-lg transition-colors duration-200">
            <Plus className="w-5 h-5" />
            翻訳ペアを追加
          </button>
          <button onClick={() => setShowAddWordModal(true)} disabled={!isAuthReady} className="flex items-center gap-2 px-4 py-2 bg-pink-600 hover:bg-pink-700 text-white font-semibold rounded-full shadow-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed">
            <BookText className="w-5 h-5" />
            単語登録
          </button>
          <button onClick={handleSaveSessionPrompts} disabled={!isAuthReady || translationPairs.every(p => !p.inputText.trim())} className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-full shadow-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed">
            <Save className="w-5 h-5" />
            セッションを保存
          </button>
          <button onClick={() => setShowLoadModal(true)} disabled={!isAuthReady} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-full shadow-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed">
            <FolderOpen className="w-5 h-5" />
            保存済みプロンプト
          </button>
          <button onClick={() => setShowDictionaryModal(true)} disabled={!isAuthReady} className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-full shadow-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed">
            <Library className="w-5 h-5" />
            ユーザー辞書
          </button>
        </div>

        <div className="space-y-8">
          {translationPairs.map((pair: TranslationPair, index: number) => (
            <div key={pair.id} className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                {/* 翻訳ペアの名前を編集可能にする */}
                {editingPairNameId === pair.id ? (
                  <input
                    type="text"
                    value={tempPairName}
                    onChange={(e) => setTempPairName(e.target.value)}
                    onBlur={() => handleSavePairName(pair.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
                    className="p-1 bg-gray-700 text-white rounded text-lg font-semibold focus:outline-none focus:ring-1 focus:ring-purple-400"
                  />
                ) : (
                  <div
                    className="text-lg font-semibold text-white cursor-pointer"
                    onDoubleClick={() => handleDoubleClickPairName(pair)}
                    title="ダブルクリックで名前を変更"
                  >
                    {pair.name}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  {/* 翻訳ペアの有効/無効切り替えボタン */}
                  <button
                    onClick={() => togglePairDisabled(pair.id)}
                    className={`p-2 rounded-full text-white shadow-md transition-colors duration-200 ${pair.isDisabled ? 'bg-gray-600 hover:bg-gray-700' : 'bg-green-600 hover:bg-green-700'}`}
                    title={pair.isDisabled ? 'このペアを有効にする' : 'このペアを無効にする'}
                  >
                    {pair.isDisabled ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  <button onClick={() => moveTranslationPair(index, index - 1)} disabled={index === 0} className="p-2 bg-gray-600 hover:bg-gray-700 rounded-full text-white shadow-md transition-colors duration-200 disabled:opacity-30 disabled:cursor-not-allowed" title="上に移動"><ArrowUp className="w-4 h-4" /></button>
                  <button onClick={() => moveTranslationPair(index, index + 1)} disabled={index === translationPairs.length - 1} className="p-2 bg-gray-600 hover:bg-gray-700 rounded-full text-white shadow-md transition-colors duration-200 disabled:opacity-30 disabled:cursor-not-allowed" title="下に移動"><ArrowDown className="w-4 h-4" /></button>
                  {translationPairs.length > 1 && (<button onClick={() => deleteTranslationPair(pair.id)} className="p-2 bg-red-600 hover:bg-red-700 rounded-full text-white shadow-md transition-colors duration-200" title="この翻訳ペアを削除"><X className="w-4 h-4" /></button>)}
                  <button onClick={() => handleSaveIndividualPrompt(pair)} disabled={!isAuthReady || !pair.inputText.trim()} className="p-2 bg-indigo-600 hover:bg-indigo-700 rounded-full text-white shadow-md transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed" title="このプロンプトを個別保存"><Save className="w-4 h-4" /></button>
                </div>
              </div>

              <div className="flex items-center justify-between mb-6">
                <div className="text-center"><div className="text-sm text-purple-200 mb-1">入力言語</div><div className="text-lg font-semibold text-white">English</div></div>
                <div className="text-center"><div className="text-sm text-purple-200 mb-1">出力言語</div><div className="text-lg font-semibold text-white">日本語</div></div>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label htmlFor={`inputText-${pair.id}`} className="text-sm font-medium text-purple-200">入力テキスト (英語)</label>
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleOpenSelectFromDictionary(pair.id)} disabled={!isAuthReady || userDictionary.length === 0} className="flex items-center gap-1 px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded-lg text-xs text-white transition-colors duration-200 disabled:opacity-50" title="辞書から単語を追加">
                        <FilePlus2 className="w-3 h-3" />辞書から追加
                      </button>
                      <div className="text-xs text-purple-300">{pair.inputText.length} 文字</div>
                    </div>
                  </div>
                  <textarea id={`inputText-${pair.id}`} value={pair.inputText} onChange={(e) => handleInputTextChange(pair.id, e.target.value)} placeholder="Example: beautiful sunset, anime style..." className="w-full h-32 p-4 bg-white/20 border-2 border-purple-300/30 rounded-xl text-white placeholder-purple-300 resize-none focus:outline-none focus:ring-2 focus:ring-purple-400 transition-colors duration-200"/>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2"><label htmlFor={`outputText-${pair.id}`} className="text-sm font-medium text-purple-200">翻訳結果 (日本語)</label><button onClick={() => copyToClipboard(pair.outputText)} disabled={!pair.outputText} className="flex items-center gap-1 px-3 py-1 bg-purple-600 hover:bg-purple-700 rounded-lg text-xs text-white transition-colors duration-200 disabled:opacity-50"><Copy className="w-3 h-3" />コピー</button></div>
                  <textarea id={`outputText-${pair.id}`} value={pair.outputText} onChange={(e) => handleOutputTextChange(pair.id, e.target.value)} placeholder="翻訳結果がここに表示されます..." className="w-full h-32 p-4 bg-white/20 border-2 border-purple-300/30 rounded-xl text-white placeholder-purple-300 resize-none focus:outline-none focus:border-purple-400 transition-colors duration-200"/>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="fixed bottom-0 left-0 right-0 z-50 bg-blue-900/90 backdrop-blur-md p-4 pt-2 rounded-t-2xl shadow-lg border-t border-blue-700">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xl font-bold text-white">結合された英語プロンプト</h2>
              <button onClick={() => copyToClipboard(processInputTextForTranslation(plainCombinedEnglishPrompts))} disabled={!plainCombinedEnglishPrompts} className="flex items-center gap-1 px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg text-sm text-white transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"><Copy className="w-4 h-4" />すべてコピー</button>
            </div>
            <div className="w-full h-24 p-3 bg-white/10 border border-blue-500/50 rounded-lg text-white font-mono text-sm overflow-auto whitespace-pre-wrap">
              {plainCombinedEnglishPrompts ? (
                // 無効化された単語を含む元のinputTextから表示し、無効化された部分をグレーアウト
                // 無効化された翻訳ペアは表示から除外されているため、ここでは考慮不要
                translationPairs.filter(p => !p.isDisabled).map((pair: TranslationPair, index: number, arr: TranslationPair[]) => {
                    // ★修正点: 無効化単語（-単語）の正規表現と表示ロジックを再調整
                    // 単語（ハイフン付き含む）と、その後に続くカンマ・スペースを保持して分割
                    const parts = pair.inputText.split(/(-?\b\w+\b(?:,\s*)?)/g).filter(Boolean);
                    return (
                        <span key={pair.id} className={pair.color}>
                            {parts.map((part, partIndex) => {
                                const trimmedPart = part.trim();
                                // 無効化の判定は、ハイフンで始まり単語境界で終わるパターン
                                const isExcluded = /^-(\b\w+\b)?$/.test(trimmedPart); 
                                return (
                                    <span key={partIndex} className={isExcluded ? 'text-gray-500 line-through' : ''}> {/* 無効化単語はグレーアウト＋打ち消し線 */}
                                        {trimmedPart.replace(/^-/, '')} {/* 表示からはハイフンを削除 */}
                                    </span>
                                );
                            })}
                            {/* 最後のペア以外は結合カンマとスペースを追加 */}
                            {index < arr.length - 1 && ', '}
                        </span>
                    );
                })
              ) : (
                <span className="text-blue-300">英語プロンプトがここに結合されます...</span>
              )}
            </div>
          </div>
        </div>

        {showSaveModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100]">
            <div className="bg-gradient-to-br from-purple-800 to-indigo-800 p-8 rounded-xl shadow-2xl w-full max-w-md border border-purple-700">
              <h3 className="text-2xl font-bold text-white mb-6 text-center">{saveModalType === 'individual' ? '個別プロンプトを保存' : 'セッションを保存'}</h3>
              <div className="mb-4">
                <label htmlFor="saveName" className="block text-purple-200 text-sm font-medium mb-2">{saveModalType === 'individual' ? 'プロンプト名' : 'セッション名'}</label>
                <input type="text" id="saveName" value={saveName} onChange={(e) => setSaveName(e.target.value)} className="w-full p-3 rounded-lg bg-white/20 text-white placeholder-purple-300 focus:outline-none focus:ring-2 focus:ring-purple-400" placeholder={saveModalType === 'individual' ? "例: 美しい風景" : "例: 猫プロンプト集"}/>
              </div>
              <div className="mb-6">
                <label htmlFor="saveGroup" className="block text-purple-200 text-sm font-medium mb-2">グループ</label>
                <select id="saveGroup" value={saveGroup} onChange={(e) => setSaveGroup(e.target.value)} className="w-full p-3 rounded-lg bg-white/20 text-white focus:outline-none focus:ring-2 focus:ring-purple-400">
                  {availableGroups.map((group: string) => (<option key={group} value={group} className="bg-gray-800">{group}</option>))}
                  <option value="新しいグループ" className="bg-gray-800">新しいグループを作成...</option>
                </select>
                {saveGroup === '新しいグループ' && (
                  <input type="text" className="w-full p-3 rounded-lg bg-white/20 text-white placeholder-purple-300 focus:outline-none focus:ring-2 focus:ring-purple-400 mt-2" placeholder="新しいグループ名" onBlur={(e) => {
                    const newGroupName = e.target.value.trim();
                    if (newGroupName && !availableGroups.includes(newGroupName)) {
                      setAvailableGroups(prev => [...prev, newGroupName].sort());
                      setSaveGroup(newGroupName);
                    } else {
                      setSaveGroup(newGroupName || '未分類');
                    }
                  }}/>
                )}
              </div>
              <div className="flex justify-end gap-3">
                <button onClick={closeSaveModal} className="px-5 py-2 bg-gray-600 hover:bg-gray-700 text-white font-semibold rounded-lg transition-colors duration-200">キャンセル</button>
                <button onClick={confirmSave} disabled={!isAuthReady || !saveName.trim()} className="px-5 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-colors duration-200 disabled:opacity-50">保存</button>
              </div>
            </div>
          </div>
        )}

        {showLoadModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100]">
            <div className="bg-gradient-to-br from-blue-800 to-indigo-800 p-8 rounded-xl shadow-2xl w-full max-w-3xl h-[80vh] flex flex-col border border-blue-700">
              <h3 className="text-2xl font-bold text-white mb-6 text-center">保存済みプロンプト</h3>
              <div className="flex-grow overflow-y-auto pr-4 custom-scrollbar">
                <h4 className="text-xl font-semibold text-blue-200 mb-3 border-b border-blue-500 pb-1">個別保存プロンプト</h4>
                {savedPrompts.length > 0 ? (
                  availableGroups.map((group: string) => (
                    <div key={`individual-${group}`} className="mb-6">
                      <h5 className="text-lg font-semibold text-blue-300 mb-2">{group}</h5>
                      <div className="space-y-3">
                        {savedPrompts.filter((p: SavedPrompt) => (p.group || '未分類') === group).map((prompt: SavedPrompt) => (
                          <div key={prompt.id} className="flex items-center bg-white/10 p-3 rounded-lg shadow-sm hover:bg-white/20 transition-colors duration-150">
                            <div className="flex-grow min-w-0"><div className="text-blue-100 font-medium truncate">{prompt.name}</div><div className="text-sm text-blue-300 break-words">{prompt.inputText}</div><div className="text-xs text-blue-400 mt-1">{prompt.timestamp.toDate().toLocaleString()}</div></div>
                            <div className="flex gap-2 ml-4 flex-shrink-0"><button onClick={() => handleLoadIndividualPrompt(prompt)} className="p-2 bg-blue-600 hover:bg-blue-700 rounded-full text-white" title="読み込む"><FolderOpen className="w-4 h-4" /></button><button onClick={() => handleDeleteSavedPrompt(prompt.id)} className="p-2 bg-red-600 hover:bg-red-700 rounded-full text-white" title="削除"><Trash2 className="w-4 h-4" /></button></div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (<p className="text-white/50 text-center mt-4 mb-8">個別保存されたプロンプトはありません。</p>)}
                <h4 className="text-xl font-semibold text-blue-200 mb-3 border-b border-blue-500 pb-1 mt-8">保存済みセッション</h4>
                {savedPromptSets.length > 0 ? (
                  availableGroups.map((group: string) => (
                    <div key={`set-${group}`} className="mb-6">
                      <h5 className="text-lg font-semibold text-blue-300 mb-2">{group}</h5>
                      <div className="space-y-3">
                        {savedPromptSets.filter((s: SavedPromptSet) => (s.group || '未分類') === group).map((promptSet: SavedPromptSet) => (
                          <div key={promptSet.id} className="flex items-center bg-white/10 p-3 rounded-lg shadow-sm hover:bg-white/20 transition-colors duration-150">
                            <div className="flex-grow min-w-0"><div className="text-blue-100 font-medium truncate">{promptSet.name}</div><div className="text-sm break-words flex flex-wrap gap-x-1">{promptSet.pairs.map((p, i) => (<span key={i} className={p.color || 'text-blue-300'}>{p.inputText}{i < promptSet.pairs.length - 1 && ', '}</span>))}</div><div className="text-xs text-blue-400 mt-1">{promptSet.timestamp.toDate().toLocaleString()}</div></div>
                            <div className="flex gap-2 ml-4 flex-shrink-0"><button onClick={() => handleLoadPromptSet(promptSet)} className="p-2 bg-blue-600 hover:bg-blue-700 rounded-full text-white" title="読み込む"><FolderOpen className="w-4 h-4" /></button><button onClick={() => handleDeleteSavedPromptSet(promptSet.id)} className="p-2 bg-red-600 hover:bg-red-700 rounded-full text-white" title="削除"><Trash2 className="w-4 h-4" /></button></div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (<p className="text-white/50 text-center mt-4">保存されたセッションはありません。</p>)}
              </div>
              <div className="flex justify-end mt-6"><button onClick={() => setShowLoadModal(false)} className="px-5 py-2 bg-gray-600 hover:bg-gray-700 text-white font-semibold rounded-lg transition-colors duration-200">閉じる</button></div>
            </div>
          </div>
        )}

        {showAddWordModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100]" onClick={() => {
            setShowAddWordModal(false);
            setEditDictionaryGroupName(null);
            setTempEditedDictionaryGroupName('');
          }}>
            {/* ★修正: max-h と overflow-y-auto を追加してスクロール可能に */}
            <div className="bg-gradient-to-br from-pink-800 to-red-800 p-8 rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col border border-pink-700 relative" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => {
                  setShowAddWordModal(false);
                  setEditDictionaryGroupName(null);
                  setTempEditedDictionaryGroupName('');
                }}
                className="absolute top-4 right-4 p-2 bg-gray-600 hover:bg-gray-700 rounded-full text-white transition-colors duration-200"
                title="閉じる"
              >
                <X className="w-5 h-5" />
              </button>

              <h3 className="text-2xl font-bold text-white mb-6 text-center">単語登録</h3>

              <div className="mb-6">
                <label htmlFor="dictionaryWordGroup" className="block text-pink-200 text-sm font-medium mb-2">グループ</label>
                <select id="dictionaryWordGroup" value={dictionaryWordGroup} onChange={(e) => {
                  setDictionaryWordGroup(e.target.value);
                  if (e.target.value === '新しいグループ') {
                    setEditDictionaryGroupName(null);
                    setTempEditedDictionaryGroupName('');
                  } else {
                    setEditDictionaryGroupName(e.target.value);
                    setTempEditedDictionaryGroupName(e.target.value);
                  }
                }}
                  className="w-full p-3 rounded-lg bg-white/20 text-white focus:outline-none focus:ring-2 focus:ring-pink-400 custom-select-height">
                  {availableDictionaryGroups.map((group: string) => (<option key={group} value={group} className="bg-gray-800">{group}</option>))}
                  <option value="新しいグループ" className="bg-gray-800">新しいグループを作成...</option>
                </select>
                {(dictionaryWordGroup === '新しいグループ' || (editDictionaryGroupName !== null && dictionaryWordGroup !== '新しいグループ')) && (
                  <div className="flex items-center gap-2 mt-2">
                    <input type="text"
                           value={tempEditedDictionaryGroupName}
                           onChange={(e) => setTempEditedDictionaryGroupName(e.target.value)}
                           className="flex-grow p-3 rounded-lg bg-white/20 text-white placeholder-pink-300 focus:outline-none focus:ring-2 focus:ring-pink-400"
                           placeholder={dictionaryWordGroup === '新しいグループ' ? "新しいグループ名 (例: 顔/目)" : "グループ名を編集 (例: 顔/目)"}
                           onBlur={(e) => {
                             const newGroupName = e.target.value.trim();
                             if (dictionaryWordGroup === '新しいグループ') {
                               if (newGroupName && !availableDictionaryGroups.includes(newGroupName)) {
                                 setAvailableDictionaryGroups(prev => [...prev, newGroupName].sort());
                                 setDictionaryWordGroup(newGroupName);
                               } else {
                                 setDictionaryWordGroup(newGroupName || '未分類');
                                 setTempEditedDictionaryGroupName(newGroupName || '');
                               }
                             } else {
                               // 既存グループの編集の場合、blurで自動保存はしない (明示的なボタンで)
                             }
                           }}
                    />
                    {editDictionaryGroupName && dictionaryWordGroup !== '新しいグループ' && (
                      <button
                        onClick={updateDictionaryGroupName}
                        disabled={!isAuthReady || !tempEditedDictionaryGroupName.trim() || tempEditedDictionaryGroupName.trim() === editDictionaryGroupName || availableDictionaryGroups.includes(tempEditedDictionaryGroupName.trim())}
                        className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg transition-colors duration-200 disabled:opacity-50"
                        title="グループ名を変更"
                      >
                        <Edit className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
              {/* 単語登録モーダル内の検索バーの追加 */}
              <div className="relative mb-4">
                <input
                  type="text"
                  placeholder="単語やグループ名を検索..."
                  className="w-full p-3 pl-10 rounded-lg bg-white/20 text-white placeholder-pink-300 focus:outline-none focus:ring-2 focus:ring-pink-400"
                  value={dictionarySearchQuery}
                  onChange={(e) => setDictionarySearchQuery(e.target.value)}
                />
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-pink-300 w-5 h-5" />
              </div>

              <div className="mb-8 p-4 bg-white/10 rounded-lg">
                <h4 className="text-xl font-semibold text-pink-200 mb-4">1単語ずつ登録</h4>
                <div className="mb-4">
                  <label htmlFor="newWordEnglish" className="block text-pink-200 text-sm font-medium mb-2">英語</label>
                  <input
                    type="text"
                    id="newWordEnglish"
                    value={newWordEnglish}
                    onChange={(e) => setNewWordEnglish(e.target.value)}
                    onKeyDown={handleSingleWordKeyPress}
                    placeholder="登録したい英語の単語"
                    className="w-full p-3 rounded-lg bg-white/20 text-white placeholder-pink-300 focus:outline-none focus:ring-2 focus:ring-pink-400"
                  />
                </div>
                <div className="mb-4">
                  <label htmlFor="newWordJapanese" className="block text-pink-200 text-sm font-medium mb-2">日本語</label>
                  <input
                    type="text"
                    id="newWordJapanese"
                    value={newWordJapanese}
                    onChange={(e) => setNewWordJapanese(e.target.value)}
                    onKeyDown={handleSingleWordKeyPress}
                    placeholder="対応する日本語"
                    className="w-full p-3 rounded-lg bg-white/20 text-white placeholder-pink-300 focus:outline-none focus:ring-2 focus:ring-pink-400"
                  />
                </div>
                <button onClick={addSingleWordToDictionary} disabled={!isAuthReady || !newWordEnglish.trim() || !newWordJapanese.trim()} className="w-full px-5 py-2 bg-pink-600 hover:bg-pink-700 text-white font-semibold rounded-lg transition-colors duration-200 disabled:opacity-50">この単語を登録</button>
              </div>

              <div className="mb-8 p-4 bg-white/10 rounded-lg">
                <h4 className="text-xl font-semibold text-pink-200 mb-4">まとめて登録</h4>
                <p className="text-sm text-pink-200 mb-2">1行に1ペアを「英語,日本語」の形式で入力してください。例:</p>
                <pre className="bg-black/30 text-pink-100 p-2 rounded-md text-xs mb-4">
                  {"apple,リンゴ\norange,オレンジ\ncat,猫"}
                </pre>
                <textarea
                  value={bulkWordsInput}
                  onChange={(e) => setBulkWordsInput(e.target.value)}
                  onKeyDown={handleBulkWordsKeyPress}
                  placeholder="ここに単語ペアを入力してください (例: apple,リンゴ)"
                  className="w-full h-32 p-3 rounded-lg bg-white/20 text-white placeholder-pink-300 resize-none focus:outline-none focus:ring-2 focus:ring-pink-400"
                />
                <button onClick={addBulkWordsToDictionary} disabled={!isAuthReady || !bulkWordsInput.trim()} className="w-full mt-4 px-5 py-2 bg-pink-600 hover:bg-pink-700 text-white font-semibold rounded-lg transition-colors duration-200 disabled:opacity-50">まとめて登録</button>
              </div>

              <div className="flex justify-end gap-3">
                <button onClick={() => {
                  setShowAddWordModal(false);
                  setEditDictionaryGroupName(null);
                  setTempEditedDictionaryGroupName('');
                }} className="px-5 py-2 bg-gray-600 hover:bg-gray-700 text-white font-semibold rounded-lg transition-colors duration-200">閉じる</button>
              </div>
            </div>
          </div>
        )}

        {showDictionaryModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100]" onClick={() => setShowDictionaryModal(false)}>
            <div className="bg-gradient-to-br from-teal-800 to-cyan-800 p-8 rounded-xl shadow-2xl w-full max-w-3xl h-[80vh] flex flex-col border border-teal-700 relative" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => setShowDictionaryModal(false)}
                className="absolute top-4 right-4 p-2 bg-gray-600 hover:bg-gray-700 rounded-full text-white transition-colors duration-200"
                title="閉じる"
              >
                <X className="w-5 h-5" />
              </button>

              <h3 className="text-2xl font-bold text-white mb-6 text-center">ユーザー辞書</h3>

              <div className="flex justify-end gap-3 mb-4 flex-wrap">
                <button
                  onClick={() => openChangeGroupModal()}
                  disabled={selectedDictionaryEntriesForDeletion.size === 0 || !isAuthReady}
                  className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white font-semibold rounded-lg transition-colors duration-200 disabled:opacity-50"
                >
                  選択した単語のグループ変更 ({selectedDictionaryEntriesForDeletion.size})
                </button>
                <button
                  onClick={() => deleteDictionaryEntries(selectedDictionaryEntriesForDeletion)}
                  disabled={selectedDictionaryEntriesForDeletion.size === 0 || !isAuthReady}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-colors duration-200 disabled:opacity-50"
                >
                  選択した単語を削除 ({selectedDictionaryEntriesForDeletion.size})
                </button>
                <button
                  onClick={deleteDictionaryGroups}
                  disabled={selectedGroupsForDeletion.size === 0 || !isAuthReady}
                  className="px-4 py-2 bg-red-800 hover:bg-red-900 text-white font-semibold rounded-lg transition-colors duration-200 disabled:opacity-50"
                >
                  選択したグループを削除 ({selectedGroupsForDeletion.size})
                </button>
              </div>

              <div className="flex-grow overflow-y-auto pr-4 custom-scrollbar">
                {userDictionary.length > 0 ? (
                  availableDictionaryGroups.map((group: string) => {
                    const entriesInGroup = userDictionary.filter(entry => (entry.group || '未分類') === group);
                    const allSelectedInGroup = entriesInGroup.every(entry => selectedDictionaryEntriesForDeletion.has(entry.id));
                    const someSelectedInGroup = entriesInGroup.some(entry => selectedDictionaryEntriesForDeletion.has(entry.id));

                    return (
                      <div key={`dictionary-group-${group}`} className="mb-6">
                        <div
                          className="flex items-center justify-between bg-white/15 p-3 rounded-lg cursor-pointer hover:bg-white/20 transition-colors duration-150 mb-2"
                          onClick={() => toggleExpandedUserDictionaryGroup(group)}
                          onDoubleClick={() => handleGroupDoubleClickToEdit(group)}
                        >
                          <h4 className="text-xl font-semibold text-teal-200">
                            {editDictionaryGroupName === group ? (
                               <div className="flex items-center gap-2 flex-grow">
                                  <input type="text"
                                    value={tempEditedDictionaryGroupName}
                                    onChange={(e) => setTempEditedDictionaryGroupName(e.target.value)}
                                    onBlur={handleSaveGroupEdit}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
                                    className="p-1 bg-gray-700 text-teal-100 rounded text-base focus:outline-none focus:ring-1 focus:ring-teal-400 flex-grow"
                                  />
                               </div>
                            ) : (
                              group.split('/').map((part, i) => (
                                <span key={i}>{i > 0 && ' / '}{part}</span>
                              ))
                            )}
                             ({entriesInGroup.length})
                          </h4>
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={allSelectedInGroup}
                              onChange={(e) => {
                                e.stopPropagation();
                                toggleSelectAllForGroupForDeletion(group, e.target.checked);
                              }}
                              className="form-checkbox h-5 w-5 text-teal-600 bg-gray-700 border-gray-600 rounded focus:ring-teal-500"
                              ref={el => {
                                if (el) {
                                  el.indeterminate = someSelectedInGroup && !allSelectedInGroup;
                                }
                              }}
                            />
                            {expandedUserDictionaryGroups.has(group) ? (
                              <ChevronUp className="w-5 h-5 text-teal-300" />
                            ) : (
                              <ChevronDown className="w-5 h-5 text-teal-300" />
                            )}
                          </div>
                        </div>
                        {expandedUserDictionaryGroups.has(group) && (
                          <div className="space-y-3 pl-4">
                            {entriesInGroup.map((entry: UserDictionaryEntry) => (
                              <div key={entry.id} className="flex items-center bg-white/10 p-3 rounded-lg shadow-sm hover:bg-white/20 transition-colors duration-150">
                                <input
                                  type="checkbox"
                                  checked={selectedDictionaryEntriesForDeletion.has(entry.id)}
                                  onChange={() => handleToggleDictionaryEntrySelectionForDeletion(entry.id)}
                                  className="form-checkbox h-5 w-5 text-red-600 bg-gray-700 border-gray-600 rounded focus:ring-red-500 mr-3"
                                />
                                <div className="flex-grow min-w-0">
                                  <div className="text-teal-100 font-medium">{entry.english}</div>
                                  <div className="text-sm text-teal-300">{entry.japanese}</div>
                                  <div className="text-xs text-teal-400 mt-1">{entry.timestamp.toDate().toLocaleString()}</div>
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openChangeGroupModal(entry);
                                  }}
                                  className="p-1 ml-2 bg-yellow-600 hover:bg-yellow-700 rounded-full text-white"
                                  title="グループを変更"
                                >
                                  <Edit className="w-4 h-4" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <p className="text-white/50 text-center mt-4">辞書に登録された単語はありません。</p>
                )}
              </div>
              <div className="flex justify-end mt-6">
                <button onClick={() => setShowDictionaryModal(false)} className="px-5 py-2 bg-gray-600 hover:bg-gray-700 text-white font-semibold rounded-lg transition-colors duration-200">閉じる</button>
              </div>
            </div>
          </div>
        )}

        {showSelectFromDictionaryModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100]" onClick={() => setShowSelectFromDictionaryModal(false)}>
            {/* 修正: モーダルコンテンツに overflow-y-auto と max-h を追加してスクロール対応 */}
            <div className="bg-gradient-to-br from-indigo-800 to-purple-800 p-8 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col border border-indigo-700 relative" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => setShowSelectFromDictionaryModal(false)}
                className="absolute top-4 right-4 p-2 bg-gray-600 hover:bg-gray-700 rounded-full text-white transition-colors duration-200"
                title="閉じる"
              >
                <X className="w-5 h-5" />
              </button>

              <h3 className="text-2xl font-bold text-white mb-6 text-center">辞書から単語を追加</h3>
              {/* 検索入力フィールド */}
              <div className="relative mb-4">
                <input
                  type="text"
                  placeholder="単語やグループ名を検索..."
                  className="w-full p-3 pl-10 rounded-lg bg-white/20 text-white placeholder-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  value={dictionarySearchQuery}
                  onChange={(e) => setDictionarySearchQuery(e.target.value)}
                />
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-300 w-5 h-5" />
              </div>

              {/* 修正: 辞書コンテンツのスクロールコンテナ */}
              <div className="flex-grow overflow-y-auto pr-4 custom-scrollbar">
                {filteredUserDictionary.length > 0 ? (
                  groupedFilteredDictionary.map(({ groupName, entries }) => { // フィルタリングされた単語をグループ表示
                    const allSelectedInGroup = entries.every(entry => selectedDictionaryEntries.has(entry.id));
                    const someSelectedInGroup = entries.some(entry => selectedDictionaryEntries.has(entry.id));

                    return (
                      <div key={`select-dictionary-group-${groupName}`} className="mb-6">
                        <div
                          className="flex items-center justify-between bg-white/15 p-3 rounded-lg cursor-pointer hover:bg-white/20 transition-colors duration-150 mb-2"
                          onClick={() => toggleExpandedDictionaryGroup(groupName)}
                        >
                          <h4 className="text-xl font-semibold text-indigo-200">
                            {groupName.split('/').map((part, i) => (
                              <span key={i}>{i > 0 && ' / '}{part}</span>
                            ))}
                             ({entries.length})
                          </h4>
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={allSelectedInGroup}
                              onChange={(e) => {
                                e.stopPropagation();
                                toggleSelectAllForGroupForAdd(groupName, e.target.checked);
                              }}
                              className="form-checkbox h-5 w-5 text-purple-600 bg-gray-700 border-gray-600 rounded focus:ring-purple-500"
                              ref={el => {
                                if (el) {
                                  el.indeterminate = someSelectedInGroup && !allSelectedInGroup;
                                }
                              }}
                            />
                            {expandedDictionaryGroups.has(groupName) ? (
                              <ChevronUp className="w-5 h-5 text-indigo-300" />
                            ) : (
                              <ChevronDown className="w-5 h-5 text-indigo-300" />
                            )}
                          </div>
                        </div>
                        {expandedDictionaryGroups.has(groupName) && (
                          <div className="space-y-3 pl-4">
                            {entries.map((entry: UserDictionaryEntry) => (
                              <div key={entry.id} className="flex items-center bg-white/10 p-3 rounded-lg shadow-sm hover:bg-white/20 transition-colors duration-150">
                                <input
                                  type="checkbox"
                                  checked={selectedDictionaryEntries.has(entry.id)}
                                  onChange={() => handleToggleDictionaryEntrySelection(entry.id)}
                                  className="form-checkbox h-5 w-5 text-purple-600 bg-gray-700 border-gray-600 rounded focus:ring-purple-500 mr-3"
                                />
                                {/* ダブルクリックで編集可能な領域 */}
                                <div
                                  className="flex-grow min-w-0 flex items-center justify-between gap-2"
                                  onDoubleClick={() => handleDoubleClickToEdit(entry)}
                                >
                                  {editingEntryId === entry.id ? (
                                    <div className="flex flex-col flex-grow">
                                      <input
                                        type="text"
                                        value={editingEnglish}
                                        onChange={(e) => setEditingEnglish(e.target.value)}
                                        onBlur={(e) => handleSaveEdit(entry.id, 'english', e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
                                        className="p-1 bg-gray-700 text-indigo-100 rounded text-sm focus:outline-none focus:ring-1 focus:ring-purple-400"
                                      />
                                      <input
                                        type="text"
                                        value={editingJapanese}
                                        onChange={(e) => setEditingJapanese(e.target.value)}
                                        onBlur={(e) => handleSaveEdit(entry.id, 'japanese', e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
                                        className="p-1 bg-gray-700 text-indigo-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-purple-400"
                                      />
                                    </div>
                                  ) : (
                                    <div className="flex-grow">
                                      <div className="text-indigo-100 font-medium">{entry.english}</div>
                                      <div className="text-sm text-indigo-300">{entry.japanese}</div>
                                    </div>
                                  )}
                                  {/* 単語削除ボタン (確認なし) */}
                                  {isAuthReady && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation(); // 親要素のダブルクリックイベントが発火しないように
                                        deleteDictionaryEntries(new Set([entry.id]));
                                      }}
                                      className="p-1 bg-red-600 hover:bg-red-700 rounded-full text-white flex-shrink-0"
                                      title="この単語を削除 (確認なし)"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                                {/* タイムスタンプは単語の編集領域の外に */}
                                <div className="text-xs text-indigo-400 mt-1 ml-auto flex-shrink-0">{entry.timestamp.toDate().toLocaleString()}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <p className="text-white/50 text-center mt-4">辞書に単語が見つかりません。</p>
                )}
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowSelectFromDictionaryModal(false)} className="px-5 py-2 bg-gray-600 hover:bg-gray-700 text-white font-semibold rounded-lg transition-colors duration-200">キャンセル</button>
                <button onClick={handleAddSelectedDictionaryEntriesToPair} disabled={selectedDictionaryEntries.size === 0} className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg transition-colors duration-200 disabled:opacity-50">選択した単語を追加</button>
              </div>
            </div>
          </div>
        )}

        {showChangeGroupModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100]" onClick={() => setShowChangeGroupModal(false)}>
            <div className="bg-gradient-to-br from-yellow-800 to-orange-800 p-8 rounded-xl shadow-2xl w-full max-w-md border border-yellow-700 relative" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => setShowChangeGroupModal(false)}
                className="absolute top-4 right-4 p-2 bg-gray-600 hover:bg-gray-700 rounded-full text-white transition-colors duration-200"
                title="閉じる"
              >
                <X className="w-5 h-5" />
              </button>

              <h3 className="text-2xl font-bold text-white mb-6 text-center">単語のグループ変更</h3>
              <p className="text-yellow-200 mb-4">
                {wordToChangeGroup ? (
                  `「**${wordToChangeGroup.english}**」を新しいグループに移動します。`
                ) : (
                  `選択した ${selectedEntriesForGroupChange.size} 件の単語を新しいグループに移動します。`
                )}
              </p>
              <div className="mb-6">
                <label htmlFor="selectNewGroup" className="block text-yellow-200 text-sm font-medium mb-2">新しいグループ</label>
                <select id="selectNewGroup" value={selectedNewGroup} onChange={(e) => setSelectedNewGroup(e.target.value)}
                  className="w-full p-3 rounded-lg bg-white/20 text-white focus:outline-none focus:ring-2 focus:ring-yellow-400 custom-select-height">
                  {availableDictionaryGroups.map((group: string) => (<option key={group} value={group} className="bg-gray-800">{group}</option>))}
                  <option value="新しいグループ" className="bg-gray-800">新しいグループを作成...</option>
                </select>
                {selectedNewGroup === '新しいグループ' && (
                  <input type="text" className="w-full p-3 rounded-lg bg-white/20 text-white placeholder-yellow-300 focus:outline-none focus:ring-2 focus:ring-yellow-400 mt-2" placeholder="新しいグループ名 (例: 顔/目)" onBlur={(e) => {
                    const newGroupName = e.target.value.trim();
                    if (newGroupName && !availableDictionaryGroups.includes(newGroupName)) {
                      setAvailableDictionaryGroups(prev => [...prev, newGroupName].sort());
                      setSelectedNewGroup(newGroupName);
                    } else {
                      setSelectedNewGroup(newGroupName || '未分類');
                    }
                  }}/>
                )}
              </div>
              <div className="flex justify-end gap-3">
                <button onClick={() => setShowChangeGroupModal(false)} className="px-5 py-2 bg-gray-600 hover:bg-gray-700 text-white font-semibold rounded-lg transition-colors duration-200">キャンセル</button>
                <button onClick={confirmChangeGroup} disabled={!isAuthReady || !selectedNewGroup.trim()} className="px-5 py-2 bg-yellow-600 hover:bg-yellow-700 text-white font-semibold rounded-lg transition-colors duration-200 disabled:opacity-50">グループを変更</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AIPromptTranslator;