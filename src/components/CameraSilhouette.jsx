import React from 'react';

export default function CameraSilhouette() {
  return (
    <div className="absolute inset-0 pointer-events-none z-10 flex flex-col justify-between p-4">
      {/* 반투명 신체 실루엣 가이드 SVG */}
      <svg 
        className="absolute inset-0 w-full h-full" 
        viewBox="0 0 200 200" 
        fill="none" 
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <mask id="body-mask">
            {/* 마스크 기본 채우기 (전체 흰색 = 가려지지 않음) */}
            <rect width="200" height="200" fill="white" />
            
            {/* 머리 영역 (검은색 = 투명하게 뚫어서 카메라가 그대로 보이게 함) */}
            <circle cx="100" cy="70" r="30" fill="black" />
            
            {/* 어깨/가슴 영역 (검은색 = 투명하게 뚫어서 카메라가 그대로 보이게 함) */}
            <path 
              d="M30 200 C30 135, 60 120, 100 120 C140 120, 170 135, 170 200 Z" 
              fill="black" 
            />
          </mask>
        </defs>

        {/* 외곽 가림막 (마스크를 씌워 머리/어깨 부분만 맑게 뚫고 나머지는 어둡게 처리) */}
        <rect 
          width="200" 
          height="200" 
          fill="rgba(0, 0, 0, 0.45)" 
          mask="url(#body-mask)" 
        />

        {/* 네온 옐로우 노랑 가이드 점선 */}
        {/* 머리 가이드 원 */}
        <circle 
          cx="100" 
          cy="70" 
          r="30" 
          stroke="#FFFF00" 
          strokeWidth="2.5" 
          strokeDasharray="4 4" 
        />
        
        {/* 어깨선 가이드 곡선 */}
        <path 
          d="M30 200 C30 135, 60 120, 100 120 C140 120, 170 135, 170 200" 
          stroke="#FFFF00" 
          strokeWidth="2.5" 
          strokeDasharray="4 4" 
        />
      </svg>

      {/* 정렬 안내 네오브루탈리즘 배지 */}
      <div className="mt-auto mx-auto mb-2 bg-[#FFFF00] text-black border-4 border-black px-4 py-1.5 rounded-xl font-black text-xs md:text-sm shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] animate-bounce text-center z-20">
        👤 노랑 가이드선에 머리와 어깨를 딱 맞춰주세요!
      </div>
    </div>
  );
}
