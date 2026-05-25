import React, { useState, useRef } from 'react';
import { useMediaPipe } from './hooks/useMediaPipe';
import CameraView from './components/CameraView';
import { supabase } from './utils/supabaseClient';
import { Flame, CheckCircle, Database, HelpCircle, AlertCircle, ArrowRight } from 'lucide-react';
import './App.css';

// 학습할 단어 목록 및 가이드 팁
const WORD_LIST = [
  { id: 'hello', word: '안녕하세요', tip: '두 손을 가볍게 펴고 명치부근에서 아래로 쓸어내려요! 👋', guideImg: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=120&h=120&q=80' },
  { id: 'thankyou', word: '감사합니다', tip: '오른손 손날로 왼손 등 위를 가볍게 두 번 탭해요! 🤝', guideImg: 'https://images.unsplash.com/photo-1530811751254-e579b17c47d9?auto=format&fit=crop&w=120&h=120&q=80' },
  { id: 'love', word: '사랑합니다', tip: '양손 주먹을 쥐고 가슴 앞에서 교차해 꼭 안아주세요! 💖', guideImg: 'https://images.unsplash.com/photo-1518199266791-5375a83190b7?auto=format&fit=crop&w=120&h=120&q=80' },
  { id: 'congratulations', word: '축하합니다', tip: '양손 손가락을 모았다가 펴며 위로 올려 꽃 피우듯 피워요! 🎉', guideImg: 'https://images.unsplash.com/photo-1513151233558-d860c5398176?auto=format&fit=crop&w=120&h=120&q=80' },
  { id: 'sorry', word: '죄송합니다', tip: '오른손 주먹을 쥐고 왼 가슴 부위에서 원을 그리며 쓸어요! 🙏', guideImg: 'https://images.unsplash.com/photo-1506784983877-45594efa4cbe?auto=format&fit=crop&w=120&h=120&q=80' }
];

export default function App() {
  const { isLoading: isMediaPipeLoading, detectFrame } = useMediaPipe();
  
  const [selectedWord, setSelectedWord] = useState(WORD_LIST[0].word);
  const [isCollecting, setIsCollecting] = useState(false);
  const [counts, setCounts] = useState({
    '안녕하세요': 0,
    '감사합니다': 0,
    '사랑합니다': 0,
    '축하합니다': 0,
    '죄송합니다': 0
  });

  const [uploadStatus, setUploadStatus] = useState({ status: 'idle', message: '' });
  const lastUploadTimeRef = useRef(0);
  const totalTarget = 50;

  // 1. 단어 선택 시 처리
  const handleWordSelect = (word) => {
    if (isCollecting) return; // 수집 중에는 변경 금지
    setSelectedWord(word);
    setUploadStatus({ status: 'idle', message: '' });
  };

  // 2. 프레임 캡처 이벤트 발생 시 처리 (Throttled: 250ms에 1장 = 초당 4장)
  const handleFrameCaptured = async (blob) => {
    const now = performance.now();
    if (now - lastUploadTimeRef.current < 250) {
      return; // 250ms 제한 (과도한 API 호출 방지)
    }
    lastUploadTimeRef.current = now;

    // 현재 단어의 수집 한도가 다 찼으면 수집 중단
    if (counts[selectedWord] >= totalTarget) {
      setIsCollecting(false);
      setUploadStatus({ status: 'success', message: `✨ '${selectedWord}' 목표 수량(50장) 달성 완료!` });
      return;
    }

    // 고유 파일 이름 생성 (학생 기기 식별 및 시간대 포함)
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substr(2, 5);
    const fileName = `skeletons/${selectedWord}/hand_${timestamp}_${randomId}.png`;

    try {
      setUploadStatus({ status: 'uploading', message: '데이터 실시간 전송 중...' });
      
      // Supabase Storage 업로드 실행 (버킷 이름: 'sign-dataset')
      const { data, error } = await supabase.storage
        .from('sign-dataset')
        .upload(fileName, blob, {
          contentType: 'image/png',
          cacheControl: '3600',
          upsert: false
        });

      if (error) {
        throw error;
      }

      // 성공 시 해당 단어의 수집 카운트 증가
      setCounts(prev => {
        const newCount = prev[selectedWord] + 1;
        if (newCount >= totalTarget) {
          setIsCollecting(false);
          setUploadStatus({ status: 'success', message: `✨ '${selectedWord}' 목표 수량(50장)을 가득 채웠어요!` });
        }
        return {
          ...prev,
          [selectedWord]: newCount
        };
      });

    } catch (err) {
      console.error("Supabase 업로드 에러:", err);
      setUploadStatus({ 
        status: 'error', 
        message: `클라우드 저장 실패! Supabase 버킷('sign-dataset') 설정을 확인해 주세요.` 
      });
      setIsCollecting(false); // 에러 발생 시 안전하게 멈춤
    }
  };

  // 수집 시작/정지 토글
  const toggleCollection = () => {
    if (counts[selectedWord] >= totalTarget) {
      // 카운트 초기화 후 재수집
      setCounts(prev => ({ ...prev, [selectedWord]: 0 }));
    }
    setIsCollecting(!isCollecting);
    setUploadStatus({ status: 'idle', message: '' });
  };

  return (
    <div className="min-h-screen p-6 md:p-12 flex flex-col items-center">
      
      {/* 🚀 헤더 영역 - 네오브루탈리즘 힙 타이틀 */}
      <header className="w-full max-w-[1000px] bg-[#00FF66] border-4 border-black rounded-3xl p-6 md:p-8 mb-8 shadow-brutal flex flex-col md:flex-row items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-5xl font-black text-black tracking-tight flex items-center gap-3">
            🤖 AI 수어 연구소 <span className="text-xl font-bold bg-black text-white px-3 py-1 rounded-full border-2 border-white">Phase 1</span>
          </h1>
          <p className="text-sm md:text-base font-bold text-black mt-2">
            초등학교 4학년 데이터 레이블러 프로젝트: 내 손 관절 정보로 인공지능을 직접 학습시켜 보아요!
          </p>
        </div>
        <div className="flex items-center gap-2 bg-white text-black border-4 border-black px-4 py-2 rounded-2xl font-black text-sm shadow-brutal-sm">
          <Database size={18} />
          <span>Supabase 클라우드 연결됨</span>
        </div>
      </header>

      {/* 🧩 메인 컨텐츠 영역 */}
      <main className="w-full max-w-[1000px] grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
        
        {/* 📋 왼쪽 단어 패널 및 가이드 (7 cols) */}
        <section className="md:col-span-7 flex flex-col gap-6 w-full">
          
          {/* 가이드 패널 */}
          <div className="bg-[#47B5FF] border-4 border-black rounded-3xl p-6 shadow-brutal relative overflow-hidden">
            <h2 className="text-2xl font-black text-black mb-4 flex items-center gap-2">
              <Flame className="fill-current text-[#FFFF00]" />
              오늘 우리가 수집할 목표 단어들
            </h2>
            <p className="text-sm font-bold text-black mb-4 leading-relaxed">
              아래 단어 중 하나를 고르고, 카메라 네모 박스 안에 정확한 수어 동작을 만들어 주세요! 
              <br /><strong>[AI에게 데이터 학습시키기]</strong> 버튼을 켜면 자동으로 뼈대 그림이 저장됩니다.
            </p>

            {/* 단어 리스트 카드형 버튼 */}
            <div className="flex flex-col gap-3">
              {WORD_LIST.map((item) => {
                const isSelected = selectedWord === item.word;
                const count = counts[item.word];
                const isCompleted = count >= totalTarget;

                return (
                  <button
                    key={item.id}
                    onClick={() => handleWordSelect(item.word)}
                    disabled={isCollecting}
                    className={`w-full text-left p-4 brutal-btn-transition border-4 border-black rounded-2xl flex items-center justify-between gap-4 ${
                      isCollecting ? 'opacity-50 cursor-not-allowed' : 'brutal-btn-hover brutal-btn-active'
                    } ${
                      isSelected 
                        ? 'bg-[#FFFF00] shadow-brutal-sm translate-x-1 translate-y-1' 
                        : 'bg-white shadow-brutal-sm'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-slate-100 border-2 border-black rounded-lg overflow-hidden flex items-center justify-center shrink-0">
                        {isCompleted ? (
                          <CheckCircle className="text-[#00FF66] fill-black stroke-[3px]" size={32} />
                        ) : (
                          <span className="text-xl font-black">{item.word[0]}</span>
                        )}
                      </div>
                      <div>
                        <div className="text-lg font-black text-black flex items-center gap-2">
                          {item.word}
                          {isCompleted && (
                            <span className="text-xs px-2 py-0.5 bg-[#00FF66] border-2 border-black rounded-full font-bold">수집완료!</span>
                          )}
                        </div>
                        <p className="text-xs font-semibold text-slate-700 mt-0.5">{item.tip}</p>
                      </div>
                    </div>

                    {/* 카운터 숫자 배지 */}
                    <div className="shrink-0 flex flex-col items-end">
                      <span className="text-xs font-black text-slate-500 uppercase">수집량</span>
                      <span className="text-lg font-black text-black">
                        {count} <span className="text-xs text-slate-600">/ {totalTarget}</span>
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 실시간 알림 피드백 패널 */}
          {uploadStatus.status !== 'idle' && (
            <div className={`border-4 border-black rounded-3xl p-5 shadow-brutal-sm flex items-start gap-3 brutal-btn-transition ${
              uploadStatus.status === 'error' ? 'bg-[#FF4A4A] text-white' :
              uploadStatus.status === 'success' ? 'bg-[#00FF66] text-black' : 'bg-white text-black'
            }`}>
              {uploadStatus.status === 'error' ? <AlertCircle size={24} className="shrink-0 stroke-[3px]" /> : <CheckCircle size={24} className="shrink-0 stroke-[3px]" />}
              <div>
                <h4 className="font-black text-lg">상태 알림</h4>
                <p className="text-sm font-semibold mt-1 leading-snug">{uploadStatus.message}</p>
              </div>
            </div>
          )}
        </section>

        {/* 📹 오른쪽 카메라 영역 및 수집 버튼 (5 cols) */}
        <section className="md:col-span-5 flex flex-col items-center gap-6 w-full">
          
          {/* 가상 카메라 뷰 */}
          <CameraView 
            detectFrame={detectFrame}
            isMediaPipeLoading={isMediaPipeLoading}
            isCollecting={isCollecting}
            onFrameCaptured={handleFrameCaptured}
          />

          {/* 🔴 수집 제어 버튼 (네오브루탈리즘 거대 버튼) */}
          <div className="w-full max-w-[480px]">
            <button
              onClick={toggleCollection}
              disabled={isMediaPipeLoading}
              className={`w-full py-5 brutal-btn-transition text-xl md:text-2xl font-black text-black border-4 border-black rounded-3xl shadow-brutal ${
                isMediaPipeLoading ? 'opacity-50 cursor-not-allowed' : 'brutal-btn-hover brutal-btn-active'
              } ${
                isCollecting 
                  ? 'bg-[#FF4A4A] text-white animate-pulse' 
                  : 'bg-[#FFFF00] text-black'
              }`}
            >
              {isCollecting ? (
                <span className="flex items-center justify-center gap-2">
                  ⏹️ 데이터 수집 일시정지 (촬영 중...)
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  🔴 AI에게 데이터 학습시키기
                </span>
              )}
            </button>
            <p className="text-center text-xs font-black text-slate-700 mt-3 flex items-center justify-center gap-1">
              <HelpCircle size={14} />
              버튼을 켜면 0.25초에 1장씩 자동으로 뼈대 이미지가 클라우드에 차곡차곡 쌓여요!
            </p>
          </div>

          {/* 현재 단어 요약 바 */}
          <div className="w-full max-w-[480px] bg-white border-4 border-black rounded-3xl p-5 shadow-brutal-sm">
            <span className="text-xs font-black text-slate-500 uppercase tracking-wider block">선택된 단어</span>
            <span className="text-2xl font-black text-black mt-1 block flex items-center gap-2">
              '{selectedWord}' <ArrowRight size={20} /> <span className="text-sm font-bold text-[#FF7800]">목표: 50장 모으기</span>
            </span>
            <div className="w-full bg-slate-200 border-2 border-black h-6 rounded-full overflow-hidden mt-3 relative">
              <div 
                className="bg-[#00FF66] h-full border-r-2 border-black transition-all duration-300"
                style={{ width: `${Math.min(100, (counts[selectedWord] / totalTarget) * 100)}%` }}
              />
              <span className="absolute inset-0 flex items-center justify-center text-xs font-black text-black">
                {counts[selectedWord]} / {totalTarget} 장 ({Math.round(Math.min(100, (counts[selectedWord] / totalTarget) * 100))}%)
              </span>
            </div>
          </div>
          
        </section>

      </main>

      {/* 푸터 */}
      <footer className="w-full max-w-[1000px] text-center text-xs font-bold text-slate-500 mt-12 py-6 border-t-2 border-slate-300">
        © 2026 AI 융합 특수교육 프로젝트 — 데이터 레이블러(Data Labeler) 양성 과정. 
      </footer>
    </div>
  );
}
