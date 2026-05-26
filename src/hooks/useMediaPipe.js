import { useEffect, useRef, useState } from 'react';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

export function useMediaPipe() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const landmarkerRef = useRef(null);

  useEffect(() => {
    let active = true;

    async function initMediaPipe() {
      try {
        // 1. MediaPipe WASM 구동에 필요한 파일셋 리졸버를 CDN으로부터 호출
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );

        // 2. 가볍고 빠른 경량 모델(float16)을 이용하여 핸드 랜드마커 인스턴스 로딩
        const handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "GPU" // 가능한 경우 GPU 가속 사용
          },
          runningMode: "VIDEO", // 실시간 카메라 처리를 위해 VIDEO 모드로 설정
          numHands: 2 // 양손 수집 및 인식을 위해 최대 2개 지원
        });

        if (active) {
          landmarkerRef.current = handLandmarker;
          setIsLoading(false);
          console.log("MediaPipe Hands가 정상적으로 초기화되었습니다.");
        }
      } catch (err) {
        console.error("MediaPipe 초기화 실패:", err);
        if (active) {
          setError(err);
          setIsLoading(false);
        }
      }
    }

    initMediaPipe();

    // 컴포넌트 언마운트 시 인스턴스 클로즈
    return () => {
      active = false;
      if (landmarkerRef.current) {
        landmarkerRef.current.close();
      }
    };
  }, []);

  /**
   * 비디오 엘리먼트로부터 프레임을 분석하여 손 관절 정보를 추출합니다.
   * @param {HTMLVideoElement} videoElement - 웹캠 피드를 보여주는 HTML5 Video 엘리먼트
   * @returns {Array|null} 감지된 모든 손의 21개 관절 좌표 배열들의 배열 또는 감지 안 될 경우 null
   */
  const detectFrame = (videoElement) => {
    if (
      !landmarkerRef.current || 
      !videoElement || 
      videoElement.readyState < 2 // HAVE_CURRENT_DATA (비디오 프레임 준비 상태 체크)
    ) {
      return null;
    }

    try {
      const timestamp = performance.now();
      const result = landmarkerRef.current.detectForVideo(videoElement, timestamp);
      
      if (result && result.landmarks && result.landmarks.length > 0) {
        // 감지된 모든 손의 21개 관절 데이터 배열의 배열을 반환
        return result.landmarks;
      }
    } catch (err) {
      console.error("프레임 감지 중 에러 발생:", err);
    }
    return null;
  };

  return { isLoading, error, detectFrame };
}
