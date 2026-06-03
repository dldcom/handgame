import React, { useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, Eye } from 'lucide-react';
import { drawSkeletonToBlob, HAND_CONNECTIONS } from '../utils/canvasRenderer';
import CameraSilhouette from './CameraSilhouette';

export default function CameraView({ 
  detectFrame, 
  isMediaPipeLoading, 
  isCollecting, 
  onFrameCaptured,
  countdown,
  recordingProgress
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const miniCanvasRef = useRef(null);
  const lastCaptureTimeRef = useRef(0);
  const [hasCamera, setHasCamera] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [stats, setStats] = useState({ fps: 0, handDetected: false });

  // 1. 카메라 스트림 켜기
  useEffect(() => {
    let stream = null;

    async function startCamera() {
      try {
        setCameraError(null);
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 }, // 해상도를 높여 웹캠의 광각 모드를 유도
            height: { ideal: 720 },
            facingMode: 'user'
            // aspectRatio: 1.0 제거 (웹캠에 따라 강제로 줌인(크롭)되는 현상 방지)
          },
          audio: false
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setHasCamera(true);
        }
      } catch (err) {
        console.error("카메라 연결 실패:", err);
        setCameraError("카메라를 켤 수 없습니다. 웹캠 권한을 승인해 주세요!");
      }
    }

    startCamera();

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // 2. 실시간 루프 (60FPS로 웹캠 화면 분석 및 UI 캔버스 렌더링)
  useEffect(() => {
    let animationId;
    let lastTime = performance.now();
    let frameCount = 0;

    const renderLoop = async () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const miniCanvas = miniCanvasRef.current;

      if (video && canvas && video.readyState >= 2) {
        const ctx = canvas.getContext('2d');
        const miniCtx = miniCanvas ? miniCanvas.getContext('2d') : null;

        // 화면 렌더링용 메인 캔버스 크기 맞추기 (1:1 비율)
        const size = Math.min(video.videoWidth, video.videoHeight);
        canvas.width = size;
        canvas.height = size;

        // 비디오 정중앙을 1:1로 크롭하여 메인 캔버스에 그리기 (거울 모드로 대칭 반전)
        ctx.save();
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1); // 좌우 반전 (거울 모드)
        
        // 원본 비디오 크롭 그리기
        const sx = (video.videoWidth - size) / 2;
        const sy = (video.videoHeight - size) / 2;
        ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);
        ctx.restore();

        // 3. MediaPipe 관절 분석 (양손 데이터 배열 반환)
        const hands = detectFrame(video);
        
        if (hands && hands.length > 0) {
          setStats(prev => ({ ...prev, handDetected: true }));

          // 메인 화면 위에 화려한 스켈레톤 라인 그리기
          ctx.lineWidth = 6;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          // 크롭 영역 원점 보정 및 좌우 대칭(거울 모드) 좌표 계산
          const getMirroredCoords = (pt) => {
            const px = pt.x * video.videoWidth;
            const py = pt.y * video.videoHeight;
            const cx = px - ((video.videoWidth - size) / 2);
            const cy = py - ((video.videoHeight - size) / 2);
            return {
              x: size - cx, // 좌우 반전
              y: cy
            };
          };

          // 감지된 모든 손을 메인 캔버스에 렌더링
          hands.forEach(handLandmarks => {
            // 뼈대 선 그리기
            HAND_CONNECTIONS.forEach(([from, to]) => {
              const start = getMirroredCoords(handLandmarks[from]);
              const end = getMirroredCoords(handLandmarks[to]);

              ctx.beginPath();
              ctx.moveTo(start.x, start.y);
              ctx.lineTo(end.x, end.y);
              ctx.strokeStyle = '#00FF66'; // 야광 그린
              ctx.stroke();
            });

            // 관절 점 그리기
            ctx.fillStyle = '#FFFFFF';
            handLandmarks.forEach(pt => {
              const coord = getMirroredCoords(pt);
              ctx.beginPath();
              ctx.arc(coord.x, coord.y, 6, 0, 2 * Math.PI);
              ctx.fill();
            });
          });

          // 4. 'AI가 보는 화면' 미니 캔버스에도 동일하게 렌더링 (224x224 검은 배경)
          if (miniCtx) {
            miniCtx.fillStyle = '#000000';
            miniCtx.fillRect(0, 0, 224, 224);

            const W = video.videoWidth;
            const H = video.videoHeight;
            const size = Math.min(W, H);
            const sx = (W - size) / 2;
            const sy = (H - size) / 2;

            miniCtx.lineWidth = 4;
            miniCtx.lineCap = 'round';
            miniCtx.lineJoin = 'round';
            miniCtx.strokeStyle = '#00FF66';

            // 감지된 모든 손을 미니 캔버스에도 1:1 크롭 비율을 유지한 채 렌더링 (위치 보존)
            hands.forEach(handLandmarks => {
              const mappedPoints = handLandmarks.map(pt => {
                const px = pt.x * W;
                const py = pt.y * H;
                const cx = px - sx;
                const cy = py - sy;
                return {
                  x: (cx / size) * 224,
                  y: (cy / size) * 224
                };
              });

              // 선 그리기
              HAND_CONNECTIONS.forEach(([from, to]) => {
                const start = mappedPoints[from];
                const end = mappedPoints[to];
                miniCtx.beginPath();
                miniCtx.moveTo(start.x, start.y);
                miniCtx.lineTo(end.x, end.y);
                miniCtx.stroke();
              });

              // 관절 점 그리기
              miniCtx.fillStyle = '#FFFFFF';
              mappedPoints.forEach(pt => {
                miniCtx.beginPath();
                miniCtx.arc(pt.x, pt.y, 3, 0, 2 * Math.PI);
                miniCtx.fill();
              });
            });
          }

        } else {
          setStats(prev => ({ ...prev, handDetected: false }));
          
          // 손 감지되지 않았을 때 미니 캔버스를 빈 검은색으로 유지
          if (miniCtx) {
            miniCtx.fillStyle = '#000000';
            miniCtx.fillRect(0, 0, 224, 224);
          }
        }

        // 5. [수집 중] 상태라면 상위 컴포넌트로 뼈대 좌표 배열을 바로 전송 (JSON 저장용)
        const nowTime = performance.now();
        // 66ms 간격으로 캡처 (1초에 약 15장, 2초에 30장) -> 수어 동작을 놓치지 않기 위함
        if (isCollecting && onFrameCaptured && (nowTime - lastCaptureTimeRef.current >= 66)) {
          lastCaptureTimeRef.current = nowTime;
          onFrameCaptured(hands || []);
        }

        // FPS 계산
        frameCount++;
        const now = performance.now();
        if (now - lastTime >= 1000) {
          setStats(prev => ({ ...prev, fps: frameCount }));
          frameCount = 0;
          lastTime = now;
        }
      }

      animationId = requestAnimationFrame(renderLoop);
    };

    renderLoop();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [detectFrame, isCollecting, onFrameCaptured]);

  return (
    <div className="flex flex-row gap-4 items-center justify-center w-full max-w-[600px] h-full min-h-0">
      {/* 카메라 컨테이너 - 네오브루탈리즘 힙 디자인 */}
      <div 
        className="relative w-full aspect-square rounded-3xl border-4 border-black bg-slate-900 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden transition-all duration-300"
        style={{ maxHeight: '50vh', maxWidth: '50vh' }}
      >
        
        {/* 숨김 처리된 원본 HTML Video */}
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline 
          className="hidden" 
        />

        {/* 신체 정렬 가이드 실루엣 */}
        {hasCamera && !isMediaPipeLoading && <CameraSilhouette />}

        {/* 카운트다운 숫자 오버레이 */}
        {countdown !== null && (
          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center z-30 pointer-events-none">
            <span className="text-7xl md:text-9xl font-black text-[#FFFF00] drop-shadow-[5px_5px_0px_rgba(0,0,0,1)] animate-ping">
              {countdown}
            </span>
          </div>
        )}

        {/* 녹화 진행 프로그레스 바 (네온 레드 하단 띠) */}
        {isCollecting && recordingProgress > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-4 bg-black border-t-4 border-black z-30 overflow-hidden">
            <div 
              className="bg-[#FF4A4A] h-full transition-all duration-100 ease-linear"
              style={{ width: `${recordingProgress}%` }}
            />
          </div>
        )}

        {/* 렌더링용 메인 Canvas */}
        <canvas 
          ref={canvasRef} 
          className="w-full h-full object-cover" 
        />

        {/* 상태 오버레이 (네오브루탈리즘 디자인 배지) */}
        <div className="absolute top-4 left-4 flex flex-col gap-2 z-10">
          <div className="flex items-center gap-1.5 px-3 py-1 bg-[#FFFF00] text-black border-2 border-black rounded-lg text-xs font-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
            <Camera size={14} className="animate-pulse" />
            <span>FPS: {stats.fps}</span>
          </div>

          <div className={`flex items-center gap-1.5 px-3 py-1 text-black border-2 border-black rounded-lg text-xs font-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-colors duration-200 ${
            stats.handDetected ? 'bg-[#00FF66]' : 'bg-[#FF4A4A] text-white'
          }`}>
            <span>{stats.handDetected ? '손 감지됨 👍' : '손 없음 ❌'}</span>
          </div>
        </div>

        {/* 로딩 오버레이 */}
        {(isMediaPipeLoading || !hasCamera) && (
          <div className="absolute inset-0 bg-[#47B5FF] flex flex-col items-center justify-center text-black font-black p-6 text-center border-t-0 border-black z-20">
            <RefreshCw size={48} className="animate-spin mb-4 stroke-[3px]" />
            <h3 className="text-xl font-black mb-2">인공지능 눈 켜는 중...</h3>
            <p className="text-sm font-semibold opacity-90">MediaPipe 모델 및 카메라 권한을 가져오고 있습니다.</p>
          </div>
        )}

        {/* 카메라 에러 오버레이 */}
        {cameraError && (
          <div className="absolute inset-0 bg-[#FF4A4A] text-white flex flex-col items-center justify-center p-6 text-center z-30">
            <h3 className="text-xl font-black mb-2">에러 발생 😢</h3>
            <p className="font-semibold">{cameraError}</p>
          </div>
        )}
      </div>

      {/* 실시간 AI 뷰어 (미니 화면) - 네오브루탈리즘 힙 서브 패널 */}
      <div className="hidden md:flex flex-col items-center shrink-0 w-[140px] bg-black text-[#00FF66] border-4 border-black rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-2 relative overflow-hidden">
        <div className="flex items-center gap-1 text-[9px] font-black uppercase tracking-wider mb-2 text-[#00FF66]">
          <Eye size={10} />
          <span>AI's EYE</span>
        </div>
        <div className="w-[100px] h-[100px] bg-slate-950 border-2 border-black rounded-lg overflow-hidden relative">
          <canvas 
            ref={miniCanvasRef} 
            width={224} 
            height={224} 
            className="w-full h-full"
          />
        </div>
      </div>
    </div>
  );
}
