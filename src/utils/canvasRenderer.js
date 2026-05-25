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
export function drawSkeletonToBlob(landmarks, normalizeSize = true) {
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

    if (!landmarks || landmarks.length < 21) {
      // 감지된 손이 없는 경우, 텅 빈 검은 화면 반환
      canvas.toBlob((blob) => resolve(blob), 'image/png');
      return;
    }

    // 3. 손 좌표 정규화 작업 (손의 크기나 거리 차이 극복)
    let processedPoints = [];
    if (normalizeSize) {
      // 3-1. 손의 바운딩 박스(최소/최대 좌표)를 구합니다.
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;

      landmarks.forEach(pt => {
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
      });

      const width = maxX - minX;
      const height = maxY - minY;
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      // 3-2. 224 픽셀의 약 75% 영역을 손이 차지하도록 크기(Scale)와 중심 이동값 적용
      const maxDim = Math.max(width, height);
      const targetSize = 224 * 0.75; // 여백 25% 확보
      const scale = maxDim > 0 ? targetSize / maxDim : 1;

      processedPoints = landmarks.map(pt => ({
        x: 112 + (pt.x - centerX) * scale,
        y: 112 + (pt.y - centerY) * scale
      }));
    } else {
      // 정규화를 안 할 경우, 단순히 0~1 값을 224 크기에 곱해줍니다.
      processedPoints = landmarks.map(pt => ({
        x: pt.x * 224,
        y: pt.y * 224
      }));
    }

    // 4. 관절 연결선 그리기 (선 굵기는 224x224 사이즈에 맞춰 4px로 선명하게 고정)
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    HAND_CONNECTIONS.forEach(([from, to]) => {
      const start = processedPoints[from];
      const end = processedPoints[to];

      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.strokeStyle = getConnectionColor(from, to);
      ctx.stroke();
    });

    // 5. 각 관절에 작은 원형 조인트(Joint) 그리기 (관절 형태 강화)
    ctx.fillStyle = '#FFFFFF'; // 흰색 점
    processedPoints.forEach(pt => {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 3, 0, 2 * Math.PI);
      ctx.fill();
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
