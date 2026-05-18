import asyncio
import json
import logging
import re
import uuid
from typing import Optional

import aiohttp
import websockets
from pydantic import BaseModel

from open_webui.env import SRC_LOG_LEVELS

logger = logging.getLogger(__name__)
logger.setLevel(SRC_LOG_LEVELS["MAIN"])


class ResultModel(BaseModel):
    """
    Execute Code Result Model
    """

    stdout: Optional[str] = ""
    stderr: Optional[str] = ""
    result: Optional[str] = ""
    files: Optional[list[dict]] = None
    file_warnings: Optional[list[str]] = None


MAX_GENERATED_FILES = 20
MAX_GENERATED_FILE_BYTES = 25 * 1024 * 1024
MAX_GENERATED_TOTAL_BYTES = 50 * 1024 * 1024
GENERATED_FILES_MARKER_START = "__OPEN_WEBUI_GENERATED_FILES_START__"
GENERATED_FILES_MARKER_END = "__OPEN_WEBUI_GENERATED_FILES_END__"


def _parse_generated_files_stdout(stdout: str) -> tuple[list[dict], list[str]]:
    if not stdout:
        return [], []

    match = re.search(
        rf"{re.escape(GENERATED_FILES_MARKER_START)}(.*?){re.escape(GENERATED_FILES_MARKER_END)}",
        stdout,
        re.DOTALL,
    )
    if not match:
        return [], []

    try:
        payload = json.loads(match.group(1))
    except Exception:
        return [], ["Failed to parse generated file manifest."]

    files = payload.get("files") if isinstance(payload, dict) else None
    warnings = payload.get("warnings") if isinstance(payload, dict) else None
    return (
        files if isinstance(files, list) else [],
        warnings if isinstance(warnings, list) else [],
    )


def _build_generated_files_collection_code() -> str:
    return f"""
import base64
import json
import os

__owui_root = globals().get("__owui_generated_dir", os.getcwd())
__owui_files = []
__owui_warnings = []
__owui_total = 0
__owui_max_files = {MAX_GENERATED_FILES}
__owui_max_file_bytes = {MAX_GENERATED_FILE_BYTES}
__owui_max_total_bytes = {MAX_GENERATED_TOTAL_BYTES}

for __owui_dirpath, __owui_dirnames, __owui_filenames in os.walk(__owui_root):
    __owui_dirnames[:] = [d for d in __owui_dirnames if d != "__pycache__"]
    for __owui_filename in __owui_filenames:
        if len(__owui_files) >= __owui_max_files:
            __owui_warnings.append("Generated file count limit reached.")
            break

        __owui_path = os.path.join(__owui_dirpath, __owui_filename)
        try:
            if not os.path.isfile(__owui_path):
                continue
            __owui_size = os.path.getsize(__owui_path)
        except OSError:
            continue

        __owui_relative_path = os.path.relpath(__owui_path, __owui_root).replace(os.sep, "/")
        if not __owui_relative_path or __owui_relative_path.startswith("../") or "/../" in __owui_relative_path:
            continue

        if __owui_size > __owui_max_file_bytes:
            __owui_warnings.append(f"Skipped oversized generated file: {{__owui_relative_path}}")
            continue
        if __owui_total + __owui_size > __owui_max_total_bytes:
            __owui_warnings.append(f"Skipped generated file after total size limit: {{__owui_relative_path}}")
            continue

        with open(__owui_path, "rb") as __owui_file:
            __owui_data = base64.b64encode(__owui_file.read()).decode("ascii")
        __owui_total += __owui_size
        __owui_files.append({{
            "name": os.path.basename(__owui_relative_path),
            "path": __owui_relative_path,
            "size": __owui_size,
            "content_base64": __owui_data,
        }})

print("{GENERATED_FILES_MARKER_START}" + json.dumps({{"files": __owui_files, "warnings": __owui_warnings}}) + "{GENERATED_FILES_MARKER_END}")
"""


class JupyterCodeExecuter:
    """
    Execute code in jupyter notebook
    """

    def __init__(
        self,
        base_url: str,
        code: str,
        token: str = "",
        password: str = "",
        timeout: int = 60,
        capture_generated_files: bool = False,
    ):
        """
        :param base_url: Jupyter server URL (e.g., "http://localhost:8888")
        :param code: Code to execute
        :param token: Jupyter authentication token (optional)
        :param password: Jupyter password (optional)
        :param timeout: WebSocket timeout in seconds (default: 60s)
        """
        self.base_url = base_url.rstrip("/")
        self.code = code
        self.token = token
        self.password = password
        self.timeout = timeout
        self.capture_generated_files = capture_generated_files
        self.generated_workdir_name = f"open-webui-code-interpreter-{uuid.uuid4().hex}"
        self.kernel_id = ""
        self.session = aiohttp.ClientSession(base_url=self.base_url)
        self.params = {}
        self.result = ResultModel()

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.kernel_id:
            try:
                async with self.session.delete(
                    f"/api/kernels/{self.kernel_id}", params=self.params
                ) as response:
                    response.raise_for_status()
            except Exception as err:
                logger.exception("close kernel failed, %s", err)
        await self.session.close()

    async def run(self) -> ResultModel:
        try:
            await self.sign_in()
            await self.init_kernel()
            await self.execute_code()
        except Exception as err:
            logger.exception("execute code failed, %s", err)
            self.result.stderr = f"Error: {err}"
        return self.result

    async def sign_in(self) -> None:
        # password authentication
        if self.password and not self.token:
            async with self.session.get("/login") as response:
                response.raise_for_status()
                xsrf_token = response.cookies["_xsrf"].value
                if not xsrf_token:
                    raise ValueError("_xsrf token not found")
                self.session.cookie_jar.update_cookies(response.cookies)
                self.session.headers.update({"X-XSRFToken": xsrf_token})
            async with self.session.post(
                "/login",
                data={"_xsrf": xsrf_token, "password": self.password},
                allow_redirects=False,
            ) as response:
                response.raise_for_status()
                self.session.cookie_jar.update_cookies(response.cookies)

        # token authentication
        if self.token:
            self.params.update({"token": self.token})

    async def init_kernel(self) -> None:
        async with self.session.post(
            url="/api/kernels", params=self.params
        ) as response:
            response.raise_for_status()
            kernel_data = await response.json()
            self.kernel_id = kernel_data["id"]

    def init_ws(self) -> (str, dict):
        ws_base = self.base_url.replace("http", "ws")
        ws_params = "?" + "&".join([f"{key}={val}" for key, val in self.params.items()])
        websocket_url = f"{ws_base}/api/kernels/{self.kernel_id}/channels{ws_params if len(ws_params) > 1 else ''}"
        ws_headers = {}
        if self.password and not self.token:
            ws_headers = {
                "Cookie": "; ".join(
                    [
                        f"{cookie.key}={cookie.value}"
                        for cookie in self.session.cookie_jar
                    ]
                ),
                **self.session.headers,
            }
        return websocket_url, ws_headers

    async def execute_code(self) -> None:
        # initialize ws
        websocket_url, ws_headers = self.init_ws()
        # execute
        async with websockets.connect(
            websocket_url, additional_headers=ws_headers
        ) as ws:
            setup_stderr = ""
            if self.capture_generated_files:
                setup_result = await self.execute_in_jupyter(
                    ws,
                    "\n".join(
                        [
                            "import os",
                            f"__owui_generated_dir = os.path.abspath({json.dumps(self.generated_workdir_name)})",
                            "os.makedirs(__owui_generated_dir, exist_ok=True)",
                            "os.chdir(__owui_generated_dir)",
                        ]
                    ),
                )
                if setup_result.stderr:
                    setup_stderr = setup_result.stderr

            self.result = await self.execute_in_jupyter(ws, self.code)
            if setup_stderr:
                self.result.stderr = f"{setup_stderr}\n{self.result.stderr}".strip()

            if self.capture_generated_files:
                collect_result = await self.execute_in_jupyter(
                    ws, _build_generated_files_collection_code()
                )
                files, warnings = _parse_generated_files_stdout(
                    collect_result.stdout or ""
                )
                self.result.files = files or None
                self.result.file_warnings = warnings or None

                await self.execute_in_jupyter(
                    ws,
                    "import os, shutil\n"
                    "__owui_root = globals().get('__owui_generated_dir', os.getcwd())\n"
                    "shutil.rmtree(__owui_root, ignore_errors=True)\n",
                )

    async def execute_in_jupyter(self, ws, code: str) -> ResultModel:
        # send message
        msg_id = uuid.uuid4().hex
        await ws.send(
            json.dumps(
                {
                    "header": {
                        "msg_id": msg_id,
                        "msg_type": "execute_request",
                        "username": "user",
                        "session": uuid.uuid4().hex,
                        "date": "",
                        "version": "5.3",
                    },
                    "parent_header": {},
                    "metadata": {},
                    "content": {
                        "code": code,
                        "silent": False,
                        "store_history": True,
                        "user_expressions": {},
                        "allow_stdin": False,
                        "stop_on_error": True,
                    },
                    "channel": "shell",
                }
            )
        )
        # parse message
        stdout, stderr, result = "", "", []
        while True:
            try:
                # wait for message
                message = await asyncio.wait_for(ws.recv(), self.timeout)
                message_data = json.loads(message)
                # msg id not match, skip
                if message_data.get("parent_header", {}).get("msg_id") != msg_id:
                    continue
                # check message type
                msg_type = message_data.get("msg_type")
                match msg_type:
                    case "stream":
                        if message_data["content"]["name"] == "stdout":
                            stdout += message_data["content"]["text"]
                        elif message_data["content"]["name"] == "stderr":
                            stderr += message_data["content"]["text"]
                    case "execute_result" | "display_data":
                        data = message_data["content"]["data"]
                        if "image/png" in data:
                            result.append(f"data:image/png;base64,{data['image/png']}")
                        elif "text/plain" in data:
                            result.append(data["text/plain"])
                    case "error":
                        stderr += "\n".join(message_data["content"]["traceback"])
                    case "status":
                        if message_data["content"]["execution_state"] == "idle":
                            break

            except asyncio.TimeoutError:
                stderr += "\nExecution timed out."
                break
        return ResultModel(
            stdout=stdout.strip(),
            stderr=stderr.strip(),
            result="\n".join(result).strip() if result else "",
        )


async def execute_code_jupyter(
    base_url: str,
    code: str,
    token: str = "",
    password: str = "",
    timeout: int = 60,
    capture_generated_files: bool = False,
) -> dict:
    async with JupyterCodeExecuter(
        base_url,
        code,
        token,
        password,
        timeout,
        capture_generated_files=capture_generated_files,
    ) as executor:
        result = await executor.run()
        return result.model_dump(exclude_none=True)
