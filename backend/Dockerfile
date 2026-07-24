# syntax=docker/dockerfile:1.7
# cam-distance backend — FastAPI + numpy/opencv-headless homography fit (프레임 디코딩 없음).
# 베이스: python:3.11-slim (Debian slim), Linux 전용.
# 의존성: pip + requirements.txt. 추론(torch/ultralytics/CUDA)·프레임 캡처·mediamtx 비대상.

FROM python:3.11-slim

# -----------------------------------------------------------------------------
# 시스템 패키지
#   - libglib2.0-0 : opencv-python-headless 런타임 의존 (GLib)
#   - ffmpeg       : ffprobe 로 등록 시점 카메라 코덱 감지 (h264=passthrough/else=libx264 결정)
#   (torch 의 libgomp1, usbutils 는 비대상 — 추론/USB 웹캠 제거)
# -----------------------------------------------------------------------------
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libglib2.0-0 \
        ffmpeg \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# -----------------------------------------------------------------------------
# 의존성 설치 (레이어 캐시 극대화)
#   opencv-python-headless 만 설치하므로 X11 의존 opencv-python 덮어쓰기
#   문제가 없다 → 강제 재설치 정리 블록 불필요.
# -----------------------------------------------------------------------------
COPY requirements.txt ./
RUN pip install -r requirements.txt

# 애플리케이션 소스 + 마이그레이션 (alembic 이 스키마 정본 — RULES §9)
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./
COPY --chmod=0755 docker-entrypoint.sh /app/docker-entrypoint.sh
# 테스트 — phase3 검증이 컨테이너 안에서 pytest 실행(docker compose exec backend pytest).
COPY tests ./tests
# Git 설정을 무시한 Windows checkout도 복구한다. CRLF/CR과 UTF-8 BOM을
# 이미지 안에서 제거하고, COPY --chmod로 호스트 파일 모드에 의존하지 않는다.
RUN python -c "from pathlib import Path; p=Path('/app/docker-entrypoint.sh'); data=p.read_bytes().removeprefix(b'\xef\xbb\xbf').replace(b'\r\n', b'\n').replace(b'\r', b'\n'); p.write_bytes(data)"

EXPOSE 8000

# 절대경로의 /bin/sh로 실행해 shebang·호스트 실행권한에 의존하지 않는다.
# 스크립트의 exec "$@"가 uvicorn을 PID 1로 교체한다.
ENTRYPOINT ["/bin/sh", "/app/docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
