// 21개 손 관절 연결 정보
export const HAND_CONNECTIONS = [
  // 엄지
  [0, 1], [1, 2], [2, 3], [3, 4],
  // 검지
  [0, 5], [5, 6], [6, 7], [7, 8],
  // 중지
  [0, 9], [9, 10], [10, 11], [11, 12],
  // 약지
  [0, 13], [13, 14], [14, 15], [15, 16],
  // 새끼
  [0, 17], [17, 18], [18, 19], [19, 20],
  // 손바닥 베이스 연결 (손바닥을 닫아 구조 완성)
  [5, 9], [9, 13], [13, 17]
];

// 각 손가락 및 관절 부위별 색상 지정 (Teachable Machine이 손가락을 더 쉽게 분별하도록 도움)
const CONNECTION_COLORS = {
  thumb: '#FF4A4A',  // 빨강 (엄지)
  index: '#FFD32D',  // 노랑 (검지)
  middle: '#47B5FF', // 파랑 (중지)
  ring: '#3EC70B',   // 초록 (약지)
  pinky: '#B000B9',  // 보라 (새끼)
  palm: '#FF7800'    // 주황 (손바닥 베이스)
};

// 특정 연결선이 어떤 손가락에 속하는지 판별
function getConnectionColor(from, to) {
  if (to <= 4) return CONNECTION_COLORS.thumb;
  if (to <= 8) return CONNECTION_COLORS.index;
  if (to <= 12) return CONNECTION_COLORS.middle;
  if (to <= 16) return CONNECTION_COLORS.ring;
  if (to <= 20) return CONNECTION_COLORS.pinky;
  return CONNECTION_COLORS.palm;
}

/**
 * 21개 손가락 관절 좌표를 받아 224x224 검은색 배경의 정규화된 뼈대 이미지 Blob을 생성합니다.
 * @param {Array} landmarks - MediaPipe가 감지한 21개 관절의 {x, y, z} 상대 좌표 배열
 * @param {boolean} normalizeSize - 손의 크기와 위치를 224x224 화면 정중앙에 꽉 차도록 정규화할지 여부 (기본값: true)
 * @returns {Promise<Blob>} PNG 이미지 Blob
 */
export function drawSkeletonToBlob(hands, options = {}) {
  return new Promise((resolve, reject) => {
    // 1. 메모리 상에 가상의 224x224 도화지 생성
    const canvas = document.createElement('canvas');
    canvas.width = 224;
    canvas.height = 224;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      reject(new Error('Canvas context를 생성할 수 없습니다.'));
      return;
    }

    // 2. 배경을 깊은 검은색(Solid Black)으로 칠합니다.
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 224, 224);

    // 하위 호환성 및 단일/양손 배열 처리
    // hands가 없거나 비어있는 경우
    if (!hands || hands.length === 0) {
      canvas.toBlob((blob) => resolve(blob), 'image/png');
      return;
    }

    // 단일 손 배열([pt0, pt1, ...])이 직접 인자로 들어온 경우 이중 배열([[pt0, pt1, ...]])로 감싸주어 규격화
    const handsArray = (hands.length > 0 && !Array.isArray(hands[0])) ? [hands] : hands;

    // options 인자가 기존의 boolean(normalizeSize) 형태로 넘어온 경우에 대응
    const normalizeSize = typeof options === 'boolean' ? options : (options.normalizeSize ?? false);
    const videoWidth = options.videoWidth ?? 640;
    const videoHeight = options.videoHeight ?? 480;

    // 3. 손 관절 좌표 변환 (정규화 혹은 크롭 비례 매핑)
    const processedHands = [];

    handsArray.forEach(handLandmarks => {
      if (!handLandmarks || handLandmarks.length < 21) return;

      let processedPoints = [];

      if (normalizeSize) {
        // 기존 방식: 개별 손을 구속 상자 중앙에 75% 크기로 채워 넣기 (위치 소멸)
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        handLandmarks.forEach(pt => {
          if (pt.x < minX) minX = pt.x;
          if (pt.x > maxX) maxX = pt.x;
          if (pt.y < minY) minY = pt.y;
          if (pt.y > maxY) maxY = pt.y;
        });

        const width = maxX - minX;
        const height = maxY - minY;
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        const maxDim = Math.max(width, height);
        const targetSize = 224 * 0.75;
        const scale = maxDim > 0 ? targetSize / maxDim : 1;

        processedPoints = handLandmarks.map(pt => ({
          x: 112 + (pt.x - centerX) * scale,
          y: 112 + (pt.y - centerY) * scale
        }));
      } else {
        // 개선 방식 (위치 보존): 웹캠 비디오의 1:1 중앙 크롭 영역 대비 좌표 비율을 224 크기에 그대로 적용
        const size = Math.min(videoWidth, videoHeight);
        const sx = (videoWidth - size) / 2;
        const sy = (videoHeight - size) / 2;

        processedPoints = handLandmarks.map(pt => {
          // 1. 원본 비디오 상의 픽셀 좌표 계산
          const px = pt.x * videoWidth;
          const py = pt.y * videoHeight;
          // 2. 1:1 크롭 영역 원점(좌상단) 기준 픽셀 좌표로 보정
          const cx = px - sx;
          const cy = py - sy;
          // 3. 224 도화지에 비례 투영
          return {
            x: (cx / size) * 224,
            y: (cy / size) * 224
          };
        });
      }

      processedHands.push(processedPoints);
    });

    // 4. 관절 연결선 그리기 (선 굵기는 224x224 사이즈에 맞춰 4px로 선명하게 고정)
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    processedHands.forEach(points => {
      HAND_CONNECTIONS.forEach(([from, to]) => {
        const start = points[from];
        const end = points[to];

        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.strokeStyle = getConnectionColor(from, to);
        ctx.stroke();
      });

      // 5. 각 관절에 작은 원형 조인트(Joint) 그리기
      ctx.fillStyle = '#FFFFFF';
      points.forEach(pt => {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 3, 0, 2 * Math.PI);
        ctx.fill();
      });
    });

    // 6. PNG Blob 형식으로 변환하여 반환
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Canvas 이미지를 PNG Blob으로 변환하는데 실패했습니다.'));
      }
    }, 'image/png');
  });
}
