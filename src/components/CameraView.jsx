import React, { useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, Eye } from 'lucide-react';
import { drawSkeletonToBlob, HAND_CONNECTIONS } from '../utils/canvasRenderer';

export default function CameraView({ 
  detectFrame, 
  isMediaPipeLoading, 
  isCollecting, 
  onFrameCaptured 
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const miniCanvasRef = useRef(null);
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
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: 'user',
            aspectRatio: 1.0 // 정사각형 비율 권장 (브라우저가 최대한 맞춰줌)
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

        // 3. MediaPipe 관절 분석
        const landmarks = detectFrame(video);
        
        if (landmarks) {
          setStats(prev => ({ ...prev, handDetected: true }));

          // 메인 화면 위에 화려한 스켈레톤 라인 그리기
          ctx.lineWidth = 6;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          // 좌우 대칭이 되었으므로 그릴 때 좌표 반전 적용
          const getMirroredCoords = (pt) => ({
            x: (1 - pt.x) * canvas.width,
            y: pt.y * canvas.height
          });

          // 뼈대 선 그리기
          HAND_CONNECTIONS.forEach(([from, to]) => {
            const start = getMirroredCoords(landmarks[from]);
            const end = getMirroredCoords(landmarks[to]);

            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
            ctx.strokeStyle = '#00FF66'; // 눈에 확 띄는 야광 그린
            ctx.stroke();
          });

          // 관절 점 그리기
          ctx.fillStyle = '#FFFFFF';
          landmarks.forEach(pt => {
            const coord = getMirroredCoords(pt);
            ctx.beginPath();
            ctx.arc(coord.x, coord.y, 6, 0, 2 * Math.PI);
            ctx.fill();
          });

          // 4. 'AI가 보는 화면' 미니 캔버스에도 동일하게 렌더링 (224x224 검은 배경)
          if (miniCtx) {
            miniCtx.fillStyle = '#000000';
            miniCtx.fillRect(0, 0, 224, 224);

            // 손가락 위치 정규화 (canvasRenderer의 수식을 미니 캔버스 시각화에 적용)
            let minX = Infinity, maxX = -Infinity;
            let minY = Infinity, maxY = -Infinity;

            landmarks.forEach(pt => {
              if (pt.x < minX) minX = pt.x;
              if (pt.x > maxX) maxX = pt.x;
              if (pt.y < minY) minY = pt.y;
              if (pt.y > maxY) maxY = pt.y;
            });

            const w = maxX - minX;
            const h = maxY - minY;
            const cX = (minX + maxX) / 2;
            const cY = (minY + maxY) / 2;
            const maxDim = Math.max(w, h);
            const scale = maxDim > 0 ? (224 * 0.75) / maxDim : 1;

            const miniPoints = landmarks.map(pt => ({
              x: 112 + (pt.x - cX) * scale,
              y: 112 + (pt.y - cY) * scale
            }));

            // 선 그리기 (화려한 네온 컬러 대신 표준 검증용 화이트/그레이 또는 선명한 컬러)
            miniCtx.lineWidth = 4;
            miniCtx.lineCap = 'round';
            miniCtx.lineJoin = 'round';
            miniCtx.strokeStyle = '#00FF66';

            HAND_CONNECTIONS.forEach(([from, to]) => {
              const start = miniPoints[from];
              const end = miniPoints[to];
              miniCtx.beginPath();
              miniCtx.moveTo(start.x, start.y);
              miniCtx.lineTo(end.x, end.y);
              miniCtx.stroke();
            });

            miniCtx.fillStyle = '#FFFFFF';
            miniPoints.forEach(pt => {
              miniCtx.beginPath();
              miniCtx.arc(pt.x, pt.y, 3, 0, 2 * Math.PI);
              miniCtx.fill();
            });
          }

          // 5. [수집 중] 상태이고 손이 감지되었다면 상위 컴포넌트로 정제된 이미지 전송
          if (isCollecting && onFrameCaptured) {
            drawSkeletonToBlob(landmarks, true)
              .then(blob => {
                onFrameCaptured(blob);
              })
              .catch(err => console.error("스냅샷 캡처 에러:", err));
          }
        } else {
          setStats(prev => ({ ...prev, handDetected: false }));
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
    <div className="flex flex-col items-center w-full max-w-[480px]">
      {/* 카메라 컨테이너 - 네오브루탈리즘 힙 디자인 */}
      <div className="relative w-full aspect-square rounded-3xl border-4 border-black bg-slate-900 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden transition-all duration-300">
        
        {/* 숨김 처리된 원본 HTML Video */}
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline 
          className="hidden" 
        />

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
      <div className="mt-6 w-[180px] bg-black text-[#00FF66] border-4 border-black rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-3 relative overflow-hidden flex flex-col items-center">
        <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider mb-2 text-[#00FF66]">
          <Eye size={12} />
          <span>AI's EYE (224 x 224)</span>
        </div>
        <div className="w-[128px] h-[128px] bg-slate-950 border-2 border-black rounded-lg overflow-hidden relative">
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
