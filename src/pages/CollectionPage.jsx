import React, { useState, useRef, useCallback } from 'react';
import { useMediaPipe } from '../hooks/useMediaPipe';
import CameraView from '../components/CameraView';
import { supabase } from '../utils/supabaseClient';
import { Flame, CheckCircle, Database, HelpCircle, AlertCircle, ArrowLeft } from 'lucide-react';
import '../App.css';

// Hex 인코딩 헬퍼 함수 (한글 -> 안전한 영문/숫자 폴더명 변환)
const encodeToHex = (str) => {
  return Array.from(new TextEncoder().encode(str))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
};

export default function CollectionPage() {
  const { isLoading: isMediaPipeLoading, detectFrame } = useMediaPipe();
  
  // 상태 관리: 단어 입력 및 확인 여부
  const [customWord, setCustomWord] = useState('');
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [count, setCount] = useState(0);
  
  // 녹화 및 타이머 상태
  const [isCollecting, setIsCollecting] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [recordingProgress, setRecordingProgress] = useState(0);
  
  // 업로드 관련 상태
  const [uploadStatus, setUploadStatus] = useState({ status: 'idle', message: '' });
  const currentSequenceRef = useRef([]); // 현재 녹화 중인 프레임 배열(시퀀스)
  const totalTarget = 10; // 목표 수량 (10세트)

  // 단어 입력 확인 처리 (입력 화면 -> 카메라 화면 전환)
  const handleConfirmWord = async (e) => {
    e.preventDefault();
    const trimmed = customWord.trim();
    if (!trimmed) {
      alert("학습시킬 수어(단어)를 먼저 입력해 주세요!");
      return;
    }

    setIsChecking(true);
    try {
      const wordId = encodeToHex(trimmed);
      const { data, error } = await supabase.storage
        .from('sign-dataset')
        .list(`skeletons/${wordId}`);
      
      if (!error && data) {
        const existingCount = data.filter(f => f.name.endsWith('.json')).length;
        setCount(existingCount);
      } else {
        setCount(0);
      }
    } catch (err) {
      console.error(err);
      setCount(0);
    }
    setIsChecking(false);

    setCustomWord(trimmed);
    setIsConfirmed(true);
    setUploadStatus({ status: 'idle', message: '' });
  };

  // 단어 다시 입력하기 (카메라 화면 -> 입력 화면 복귀)
  const handleResetWord = () => {
    if (isCollecting || countdown !== null) {
      alert("녹화 중에는 단어를 변경할 수 없습니다.");
      return;
    }
    setIsConfirmed(false);
    setCustomWord('');
    setCount(0);
    setUploadStatus({ status: 'idle', message: '' });
  };

  // 프레임 캡처 이벤트 발생 시 처리 (순수 좌표 데이터)
  const handleFrameCaptured = useCallback((hands) => {
    if (count >= totalTarget) return;
    if (!isCollecting) return;

    // 현재 세트(시퀀스)에 좌표 프레임 추가
    currentSequenceRef.current.push({
      timestamp: Date.now(),
      hands: hands
    });

    const currentFrames = currentSequenceRef.current.length;
    const targetFrames = 30; // 황금 데이터 기준인 30프레임 고정

    if (currentFrames >= targetFrames) {
      // 30장이 꽉 차면 수집 종료 및 업로드 시작
      setIsCollecting(false);
      setRecordingProgress(0);
      
      const sequenceToUpload = [...currentSequenceRef.current];
      currentSequenceRef.current = []; // 초기화
      uploadSequence(sequenceToUpload);
    } else {
      // 진행률 게이지 업데이트
      setRecordingProgress((currentFrames / targetFrames) * 100);
    }
  }, [count, totalTarget, isCollecting]);

  // 하나의 시퀀스(세트) 녹화가 끝난 후 JSON 파일로 통합 업로드
  const uploadSequence = async (sequenceData) => {
    const wordId = encodeToHex(customWord);
    const seqId = `seq_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const fileName = `skeletons/${wordId}/${seqId}.json`;

    try {
      setUploadStatus({ status: 'uploading', message: '데이터 세트 전송 중...' });
      
      const jsonString = JSON.stringify(sequenceData);
      const blob = new Blob([jsonString], { type: 'application/json' });
      
      const { error } = await supabase.storage
        .from('sign-dataset')
        .upload(fileName, blob, {
          contentType: 'application/json',
          cacheControl: '3600',
          upsert: false
        });

      if (error) throw error;

      setCount(prev => {
        const newCount = prev + 1;
        if (newCount >= totalTarget) {
          setIsCollecting(false);
          setUploadStatus({ status: 'success', message: `✨ '${customWord}' 목표 수량(${totalTarget}세트) 달성 완료!` });
        } else {
          setUploadStatus({ status: 'success', message: `✨ 1세트 녹화 완료! 현재 ${newCount}/${totalTarget} 세트 수집됨.` });
        }
        return newCount;
      });

    } catch (err) {
      console.error("Supabase 업로드 에러:", err);
      setUploadStatus({ 
        status: 'error', 
        message: `클라우드 저장 실패! Supabase 연결 상태를 확인해 주세요.` 
      });
      setIsCollecting(false);
    }
  };

  // 3초 카운트다운 후 2초 버스트 녹화 실행
  const startBurstCollection = () => {
    if (isCollecting || countdown !== null || isMediaPipeLoading) return;

    if (count >= totalTarget) {
      setCount(0); // 50장 가득 찬 상태에서 누르면 다시 0부터 수집
    }
    setUploadStatus({ status: 'idle', message: '' });

    let currentCount = 3;
    setCountdown(currentCount);

    const countInterval = setInterval(() => {
      currentCount -= 1;
      if (currentCount > 0) {
        setCountdown(currentCount);
      } else if (currentCount === 0) {
        setCountdown("시작! 🎬");
      } else {
        clearInterval(countInterval);
        setCountdown(null);

        // 카운트다운이 끝나면 배열을 초기화하고 수집 상태(isCollecting)를 true로 켭니다.
        // 그러면 handleFrameCaptured 함수가 프레임 개수를 세면서 30장이 될 때까지 알아서 데이터를 모읍니다.
        currentSequenceRef.current = [];
        setRecordingProgress(0);
        setIsCollecting(true);
      }
    }, 1000);
  };

  return (
    <div className="h-full overflow-hidden p-2 md:p-4 flex flex-col items-center bg-slate-50">
      
      {/* 헤더 영역 (높이 및 여백 축소) */}
      <header className="w-full max-w-[1000px] bg-[#00FF66] border-4 border-black rounded-2xl p-3 md:p-4 mb-4 shadow-brutal-sm flex flex-row items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-xl md:text-2xl font-black text-black tracking-tight flex items-center gap-2">
            🤖 AI 수어 연구소 <span className="text-xs font-bold bg-black text-white px-2 py-0.5 rounded-full border-2 border-white">Phase 2</span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => window.location.hash = '#practice'}
            className="flex items-center gap-1.5 bg-black text-white border-2 border-black px-3 py-1.5 rounded-xl font-black text-xs shadow-brutal-sm hover:bg-slate-800"
          >
            실전 연습하기
          </button>
          <div className="flex items-center gap-1.5 bg-white text-black border-2 border-black px-3 py-1.5 rounded-xl font-black text-xs shadow-brutal-sm">
            <Database size={14} />
            <span className="hidden md:inline">Supabase 연결됨</span>
          </div>
        </div>
      </header>

      <main className="w-full max-w-[1000px] flex flex-col items-center flex-1 min-h-0">
        
        {/* 단계 1: 단어 입력창 (isConfirmed가 false일 때 표시) */}
        {!isConfirmed ? (
          <div className="w-full max-w-[600px] bg-[#FFFF00] border-4 border-black rounded-3xl p-8 md:p-12 shadow-brutal text-center transition-all animate-in fade-in zoom-in-95 duration-300">
            <h2 className="text-2xl md:text-3xl font-black text-black mb-8">
              어떤 수어를 학습시킬까요? ✍️
            </h2>
            <form onSubmit={handleConfirmWord} className="flex flex-col gap-5">
              <input 
                type="text" 
                value={customWord}
                onChange={(e) => setCustomWord(e.target.value)}
                placeholder="예: 사과, 친구, 반가워 등" 
                className="w-full text-center text-2xl font-black p-5 border-4 border-black rounded-2xl shadow-[inset_4px_4px_0px_0px_rgba(0,0,0,0.1)] outline-none focus:ring-4 focus:ring-black placeholder-slate-400"
                autoFocus
              />
              <button 
                type="submit"
                disabled={isChecking}
                className={`w-full text-white text-xl font-black p-5 rounded-2xl border-4 border-black shadow-brutal transition-all ${
                  isChecking 
                    ? 'bg-slate-500 cursor-not-allowed opacity-70' 
                    : 'bg-black hover:bg-slate-800 active:translate-y-1 active:translate-x-1'
                }`}
              >
                {isChecking ? '기존 데이터 확인 중...' : '확인 (카메라 켜기)'}
              </button>
            </form>
            <p className="text-sm font-bold text-slate-800 mt-6 opacity-80 leading-relaxed">
              입력하신 단어 이름으로 클라우드에 폴더가 생성되며,<br/>
              사진이 안전하게 자동 저장됩니다.
            </p>
          </div>
        ) : (
          /* 단계 2: 녹화 화면 (isConfirmed가 true일 때 표시) */
          <div className="w-full h-full grid grid-cols-1 md:grid-cols-12 gap-4 items-center animate-in fade-in duration-500 min-h-0">
            
            {/* 왼쪽 통합 제어 패널 (4 cols) */}
            <section className="md:col-span-4 flex flex-col gap-3 w-full h-full justify-center">
              <div className="bg-white border-4 border-black rounded-3xl p-5 shadow-brutal flex flex-col gap-4">
                
                {/* 단어 정보 */}
                <div>
                  <button 
                    onClick={handleResetWord}
                    className="flex items-center gap-1 text-xs font-black text-slate-600 mb-2 hover:text-black transition-colors px-2 py-1 border-2 border-transparent hover:border-black rounded-lg hover:bg-slate-100"
                  >
                    <ArrowLeft size={14} /> 다시 입력
                  </button>
                  <span className="text-[10px] font-black bg-black text-white px-2 py-0.5 rounded-full border-2 border-white uppercase tracking-wider inline-block mb-1">
                    학습 중인 수어
                  </span>
                  <h3 className="text-3xl font-black text-black break-keep leading-none">
                    '{customWord}'
                  </h3>
                </div>

                {/* 진행률 패널 */}
                <div className="bg-[#47B5FF] border-2 border-black rounded-2xl p-4 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                  <h4 className="font-black text-sm text-black mb-2 flex items-center gap-1.5">
                    <Flame size={16} className="fill-current text-[#FFFF00]" />
                    진행률
                  </h4>
                  <div className="w-full bg-slate-200 border-2 border-black h-6 rounded-full overflow-hidden relative shadow-[inset_2px_2px_0px_0px_rgba(0,0,0,0.2)]">
                    <div 
                      className="bg-[#00FF66] h-full border-r-2 border-black transition-all duration-300 ease-out"
                      style={{ width: `${Math.min(100, (count / totalTarget) * 100)}%` }}
                    />
                    <span className="absolute inset-0 flex items-center justify-center text-xs font-black text-black drop-shadow-[0px_1px_1px_rgba(255,255,255,0.8)]">
                      {count} / {totalTarget} 세트
                    </span>
                  </div>
                </div>

                {/* 알림 패널 */}
                {uploadStatus.status !== 'idle' && (
                  <div className={`border-2 border-black rounded-xl p-3 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] flex items-start gap-2 transition-all animate-in slide-in-from-top-2 ${
                    uploadStatus.status === 'error' ? 'bg-[#FF4A4A] text-white' :
                    uploadStatus.status === 'success' ? 'bg-[#00FF66] text-black' : 'bg-slate-100 text-black'
                  }`}>
                    {uploadStatus.status === 'error' ? <AlertCircle size={18} className="shrink-0 stroke-[3px] mt-0.5" /> : <CheckCircle size={18} className="shrink-0 stroke-[3px] mt-0.5" />}
                    <p className="text-xs font-bold leading-tight">{uploadStatus.message}</p>
                  </div>
                )}
              </div>
            </section>

            {/* 오른쪽 카메라 & 녹화 버튼 영역 (8 cols) */}
            <section className="md:col-span-8 flex flex-col items-center justify-center gap-4 w-full h-full min-h-0">
              <CameraView 
                detectFrame={detectFrame}
                isMediaPipeLoading={isMediaPipeLoading}
                isCollecting={isCollecting}
                onFrameCaptured={handleFrameCaptured}
                countdown={countdown}
                recordingProgress={recordingProgress}
              />

              <div className="w-full max-w-[480px] shrink-0 mt-2">
                <button
                  onClick={startBurstCollection}
                  disabled={isMediaPipeLoading || isCollecting || countdown !== null}
                  className={`w-full py-4 text-xl font-black text-black border-4 border-black rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all ${
                    (isMediaPipeLoading || isCollecting || countdown !== null)
                      ? 'opacity-50 cursor-not-allowed bg-slate-300'
                      : 'bg-[#FFFF00] hover:bg-[#FFE600] active:translate-y-1 active:translate-x-1'
                  }`}
                >
                  {countdown !== null ? (
                    <span className="flex items-center justify-center gap-2 animate-pulse text-black">
                      ⏱️ 준비하세요... {countdown}
                    </span>
                  ) : isCollecting ? (
                    <span className="flex items-center justify-center gap-2 animate-pulse text-red-600">
                      🎥 30장 연속 촬영 중! (동작 취하기)
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      🔴 3초 후 30장 연속 촬영하기
                    </span>
                  )}
                </button>
                <p className="text-center text-xs font-black text-slate-700 mt-3 flex items-center justify-center gap-1 bg-white p-2 rounded-xl border-2 border-slate-300 inline-block w-full">
                  <HelpCircle size={14} className="inline mr-1" />
                  버튼을 누르면 3초의 준비 시간 후 30프레임이 모두 모일 때까지 자동으로 녹화됩니다.
                </p>
              </div>
            </section>
          </div>
        )}
      </main>

      <footer className="w-full text-center text-[10px] font-bold text-slate-400 mt-2 shrink-0">
        © 2026 AI 수어 프로젝트 — Data Labeler
      </footer>
    </div>
  );
}


