import { forwardRef, useEffect, useRef, useState } from "react";
import { whepBase } from "../hooks/useApi";

interface Props {
  streamKey: string;
  onFps?: (fps: number) => void;
}

// mediamtx WHEP 플레이어 — native RTCPeerConnection. 무거운 lib 없이 ~40줄.
// createOffer → POST SDP → setRemoteDescription(answer) → ontrack → <video>.
//
// forwardRef 로 내부 <video> element 를 부모에 노출한다(측정 뷰가 frame grab·
// 클릭 좌표 매핑에 직접 접근). 내부 WebRTC 로직은 여전히 자체 videoRef 를 쓰고,
// <video> 의 콜백 ref 가 내부 ref + 부모 ref 둘 다에 element 를 할당(merge-ref).
// 기존 grid 호출자는 ref 를 안 넘기므로 무영향.
const WhepPlayer = forwardRef<HTMLVideoElement, Props>(function WhepPlayer(
  { streamKey, onFps },
  forwardedRef,
) {
  // merge-ref 에서 .current 에 할당하므로 mutable 형태로 선언.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState(false);
  // onFps 를 ref 로 잡아 effect dep 에서 뺀다 — inline 콜백이 매 렌더 새로 생겨도
  // WebRTC 가 재연결되지 않도록(dep=[streamKey] 만 유지).
  const onFpsRef = useRef(onFps);
  onFpsRef.current = onFps;

  useEffect(() => {
    const pc = new RTCPeerConnection();
    let aborted = false;

    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });

    pc.ontrack = (ev) => {
      if (videoRef.current) videoRef.current.srcObject = ev.streams[0];
    };

    // 실측 FPS — mediamtx API 엔 FPS 가 없고(백엔드는 프레임 안 만짐) WebRTC 로
    // 디코딩되는 실제 프레임레이트를 잰다: inbound-rtp(video) framesDecoded 증분 / 시간.
    let lastFrames = 0;
    let lastTs = 0;
    const fpsTimer = window.setInterval(async () => {
      const stats = await pc.getStats();
      stats.forEach((raw) => {
        const r = raw as RTCInboundRtpStreamStats & { mediaType?: string };
        const kind = r.mediaType ?? r.kind;
        if (r.type === "inbound-rtp" && kind === "video" && r.framesDecoded != null) {
          if (lastTs) {
            const dt = (r.timestamp - lastTs) / 1000;
            if (dt > 0) onFpsRef.current?.(Math.max(0, (r.framesDecoded - lastFrames) / dt));
          }
          lastFrames = r.framesDecoded;
          lastTs = r.timestamp;
        }
      });
    }, 1000);

    (async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const resp = await fetch(`${whepBase()}/${streamKey}/whep`, {
          method: "POST",
          headers: { "Content-Type": "application/sdp" },
          body: offer.sdp,
        });
        if (!resp.ok) throw new Error(`WHEP ${resp.status}`);

        const answer = await resp.text();
        if (aborted) return;
        await pc.setRemoteDescription({ type: "answer", sdp: answer });
      } catch {
        if (!aborted) setFailed(true);
      }
    })();

    return () => {
      aborted = true;
      window.clearInterval(fpsTimer);
      pc.close();
    };
  }, [streamKey]);

  if (failed) {
    return <span className="grid-cell-nosignal">연결 실패</span>;
  }

  // merge-ref: 내부 videoRef(WebRTC) + 부모 forwardedRef 둘 다에 element 할당.
  const setVideo = (el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (typeof forwardedRef === "function") forwardedRef(el);
    else if (forwardedRef) forwardedRef.current = el;
  };

  return <video ref={setVideo} className="grid-cell-video" autoPlay muted playsInline />;
});

export default WhepPlayer;
