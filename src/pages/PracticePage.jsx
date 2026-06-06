import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as tf from '@tensorflow/tfjs';
import { useMediaPipe } from '../hooks/useMediaPipe';
import CameraView from '../components/CameraView';
import { supabase } from '../utils/supabaseClient';
import { Brain, Volume2, VolumeX, Home, Loader2, Play } from 'lucide-react';
import '../App.css';

const FEATURES_PER_FRAME = 126; // 2손 * 21관절 * 3차원
const TARGET_FRAMES = 30;

// 좌표 데이터를 126차원 평탄화 및 Zero-padding 처리하는 함수 (파이썬과 동일 로직)
const extractFeatures = (hands) => {
  const features = new Array(FEATURES_PER_FRAME).fill(0);
  if (!hands || hands.length === 0) return features;
  
  const hand1 = hands[0];
  for (let i = 0; i < 21; i++) {
    if (hand1[i]) {
      features[i * 3] = hand1[i].x || 0;
      features[i * 3 + 1] = hand1[i].y || 0;
      features[i * 3 + 2] = hand1[i].z || 0;
    }
  }
  
  if (hands.length > 1) {
    const hand2 = hands[1];
    for (let i = 0; i < 21; i++) {
      if (hand2[i]) {
        features[63 + i * 3] = hand2[i].x || 0;
        features[63 + i * 3 + 1] = hand2[i].y || 0;
        features[63 + i * 3 + 2] = hand2[i].z || 0;
      }
    }
  }
  return features;
};

export default function PracticePage() {
  const { isLoading: isMediaPipeLoading, detectFrame } = useMediaPipe();
  
  const [model, setModel] = useState(null);
  const [labels, setLabels] = useState([]);
  const [isModelLoading, setIsModelLoading] = useState(true);
  
  const [isMuted, setIsMuted] = useState(false);
  const [resultText, setResultText] = useState('');
  
  // 상태머신: 'idle' (대기), 'recording' (30프레임 수집중), 'cooldown' (결과 출력 후 휴식)
  const [appState, setAppState] = useState('idle'); 
  const sequenceBufferRef = useRef([]);

  // TTS 함수 (아이 목소리 톤 적용)
  const speakText = useCallback((text) => {
    if (isMuted) return;
    const synth = window.speechSynthesis;
    // 이전 발화 취소
    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    
    // 한국어 음성 찾기
    const voices = synth.getVoices();
    const koVoice = voices.find(v => v.lang.includes('ko'));
    if (koVoice) {
      utterance.voice = koVoice;
    }
    
    // 어린아이처럼 통통 튀고 약간 빠른 톤 설정
    utterance.pitch = 1.6;
    utterance.rate = 1.1;
    
    synth.speak(utterance);
  }, [isMuted]);

  // 모델 및 라벨 로드
  useEffect(() => {
    const loadAiModel = async () => {
      try {
        const MODEL_BUCKET = 'models';
        
        // Supabase Storage에서 공용 URL 가져오기
        const { data: { publicUrl: modelUrl } } = supabase.storage.from(MODEL_BUCKET).getPublicUrl('model.json');
        const { data: { publicUrl: labelsUrl } } = supabase.storage.from(MODEL_BUCKET).getPublicUrl('word_labels.json');

        // 모델 로드
        const loadedModel = await tf.loadLayersModel(modelUrl);
        setModel(loadedModel);
        
        // 라벨 로드
        const res = await fetch(labelsUrl);
        const loadedLabels = await res.json();
        setLabels(loadedLabels);
      } catch (err) {
        console.error("AI 뇌(모델)를 불러오지 못했습니다.", err);
      } finally {
        setIsModelLoading(false);
      }
    };
    loadAiModel();
    
    // 음성 초기화 버그 방지
    window.speechSynthesis.getVoices();
  }, []);

  // 프레임 감지 콜백
  const handleFrameCaptured = useCallback(async (hands) => {
    // 쿨타임 중이거나 모델이 없으면 무시
    if (appState === 'cooldown' || !model || labels.length === 0) return;

    // 대기 상태일 때 손이 나타나면 수집 시작!
    if (appState === 'idle') {
      if (hands && hands.length > 0) {
        setAppState('recording');
        setResultText('');
        sequenceBufferRef.current = [extractFeatures(hands)];
      }
      return; // 첫 프레임 수집 후 종료
    }

    // 수집 중일 때
    if (appState === 'recording') {
      const features = extractFeatures(hands);
      sequenceBufferRef.current.push(features);

      // 30장이 꽉 차면 예측 진행
      if (sequenceBufferRef.current.length >= TARGET_FRAMES) {
        setAppState('cooldown'); // 즉시 쿨타임 진입 (중복 감지 방지)
        
        const tensorData = tf.tensor([sequenceBufferRef.current]); // 형태: [1, 30, 126]
        sequenceBufferRef.current = []; // 버퍼 비우기

        try {
          const prediction = model.predict(tensorData);
          const probArray = await prediction.data();
          tensorData.dispose();
          prediction.dispose();

          const maxProb = Math.max(...probArray);
          const maxIdx = probArray.indexOf(maxProb);

          // 80% 이상의 확신이 있을 때만 정답 출력
          if (maxProb > 0.8) {
            const answer = labels[maxIdx];
            setResultText(answer);
            speakText(answer);
          } else {
            setResultText('?'); // 확신이 안 서면 물음표
          }
        } catch (error) {
          console.error("예측 중 에러:", error);
        }

        // 2.5초 후 다시 대기 상태로 복귀
        setTimeout(() => {
          setAppState('idle');
          setResultText('');
        }, 2500);
      }
    }
  }, [appState, model, labels, speakText]);

  return (
    <div className="h-full overflow-hidden p-2 md:p-4 flex flex-col items-center bg-slate-50">
      
      {/* 헤더 영역 */}
      <header className="w-full max-w-[1000px] bg-black text-white border-4 border-black rounded-2xl p-4 mb-4 shadow-[4px_4px_0px_0px_rgba(71,181,255,1)] flex flex-row items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Brain size={28} className="text-[#00FF66]" />
          <div>
            <h1 className="text-xl md:text-2xl font-black tracking-tight flex items-center gap-2">
              실전 수어 연습 <span className="text-xs font-bold bg-[#FF4A4A] text-white px-2 py-0.5 rounded-full border-2 border-white">Phase 4</span>
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setIsMuted(!isMuted)}
            className={`p-2 rounded-xl border-2 border-transparent transition-colors ${isMuted ? 'bg-red-500 hover:bg-red-600' : 'bg-slate-800 hover:bg-slate-700'}`}
          >
            {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
          </button>
          <button 
            onClick={() => window.location.hash = ''}
            className="flex items-center gap-1.5 bg-white text-black border-2 border-black px-3 py-2 rounded-xl font-black text-sm hover:bg-slate-200"
          >
            <Home size={16} /> 홈
          </button>
        </div>
      </header>

      {/* 학습된 단어 목록 표시줄 */}
      <div className="w-full max-w-[1000px] bg-white border-4 border-black rounded-2xl p-3 mb-4 shadow-brutal-sm flex items-center gap-2 shrink-0 overflow-x-auto whitespace-nowrap">
        <span className="font-black text-sm bg-[#FFFF00] px-2 py-1 border-2 border-black rounded-lg">🟢 AI 뇌 탑재 완료</span>
        {isModelLoading ? (
          <span className="text-sm font-bold text-slate-500 animate-pulse flex items-center gap-1">
            <Loader2 size={14} className="animate-spin" /> 모델 불러오는 중...
          </span>
        ) : labels.length > 0 ? (
          <span className="text-sm font-bold text-slate-700">
            인식 가능한 단어: {labels.join(', ')}
          </span>
        ) : (
          <span className="text-sm font-bold text-[#FF4A4A]">
            아직 학습된 데이터가 없습니다. 먼저 수어를 학습시켜주세요!
          </span>
        )}
      </div>

      <main className="w-full max-w-[1000px] flex flex-col items-center flex-1 min-h-0 relative gap-4">
        
        {/* 카메라 영역 */}
        <div className="w-full flex-1 relative flex justify-center items-center">
          <div className="w-full max-w-[800px] aspect-video max-h-[50vh] relative z-10">
            <CameraView 
              detectFrame={detectFrame}
              isMediaPipeLoading={isMediaPipeLoading}
              isCollecting={appState !== 'cooldown'}
              onFrameCaptured={handleFrameCaptured}
              countdown={null}
              recordingProgress={appState === 'recording' ? (sequenceBufferRef.current.length / TARGET_FRAMES) * 100 : 0}
            />
            
            {/* 녹화 상태 인디케이터 */}
            {appState === 'recording' && (
              <div className="absolute top-4 right-4 bg-red-600 text-white font-black px-3 py-1.5 border-2 border-white rounded-full flex items-center gap-2 animate-pulse z-20 shadow-lg">
                <div className="w-2.5 h-2.5 bg-white rounded-full"></div>
                인식 중...
              </div>
            )}
          </div>
        </div>

        {/* 결과 출력기 영역 */}
        <div className="w-full h-32 md:h-40 bg-white border-4 border-black rounded-3xl shadow-brutal flex items-center justify-center shrink-0 relative overflow-hidden">
          {appState === 'idle' ? (
            <div className="text-2xl md:text-3xl font-black text-slate-400 flex items-center gap-2 animate-pulse">
              <Play className="fill-slate-400" />
              수어 동작을 취해주세요...
            </div>
          ) : appState === 'recording' ? (
            <div className="text-2xl md:text-3xl font-black text-black">
              분석 중...
            </div>
          ) : (
            <div className="text-5xl md:text-7xl font-black text-[#00FF66] [text-shadow:-4px_-4px_0_#000,4px_-4px_0_#000,-4px_4px_0_#000,4px_4px_0_#000] animate-in zoom-in spin-in-2 duration-300">
              {resultText === '?' ? '🤔 다시 해보세요' : resultText}
            </div>
          )}
        </div>

      </main>
    </div>
  );
}
