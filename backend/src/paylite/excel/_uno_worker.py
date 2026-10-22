"""Executed only by Debian's UNO Python, with no application secrets or database access."""

import ctypes
import errno
import json
import os
import resource
import subprocess
import sys
import time
from pathlib import Path
from uuid import uuid4


def _checked(value: int) -> int:
    if value < 0:
        raise OSError(ctypes.get_errno(), "Excel sandbox unavailable")
    return value


def sandbox(task: Path) -> None:
    # Linux UAPI: require ABI 6, including truncation and IPC/signal scope restrictions.
    libc = ctypes.CDLL(None, use_errno=True)
    if _checked(libc.syscall(444, 0, 0, 1)) < 6:
        raise RuntimeError("Landlock ABI 6 required")

    class Ruleset(ctypes.Structure):
        _fields_ = [("fs", ctypes.c_uint64), ("net", ctypes.c_uint64), ("scope", ctypes.c_uint64)]

    class PathRule(ctypes.Structure):
        _pack_ = 1
        _fields_ = [("access", ctypes.c_uint64), ("fd", ctypes.c_int32)]

    # All ABI-3 filesystem rights; no TCP ports granted. seccomp also denies UDP/raw sockets.
    rights = (1 << 15) - 1
    rules = Ruleset(rights, 3, 3)
    descriptor = _checked(libc.syscall(444, ctypes.byref(rules), ctypes.sizeof(rules), 0))
    read = (1 << 0) | (1 << 2) | (1 << 3)
    allowed = [(task, rights)]
    allowed += [
        (Path(path), read)
        for path in (
            "/usr",
            "/lib",
            "/lib64",
            "/etc/fonts",
            "/etc/libreoffice",
            "/var/lib/libreoffice",
            "/var/spool/libreoffice",
            "/var/cache/fontconfig",
        )
    ]
    allowed += [
        (Path(path), 1 << 2)
        for path in ("/etc/ld.so.cache", "/etc/localtime", "/etc/passwd", "/etc/group")
    ]
    allowed += [(Path(path), (1 << 1) | (1 << 2)) for path in ("/dev/null", "/dev/urandom")]
    try:
        for path, access in allowed:
            if not path.exists():
                continue
            handle = os.open(path, os.O_PATH | os.O_CLOEXEC)
            try:
                rule = PathRule(access, handle)
                _checked(libc.syscall(445, descriptor, 1, ctypes.byref(rule), 0))
            finally:
                os.close(handle)
        _checked(libc.prctl(38, 1, 0, 0, 0))  # PR_SET_NO_NEW_PRIVS
        _checked(libc.syscall(446, descriptor, 0))
    finally:
        os.close(descriptor)

    class Argument(ctypes.Structure):
        _fields_ = [
            ("arg", ctypes.c_uint),
            ("op", ctypes.c_int),
            ("a", ctypes.c_uint64),
            ("b", ctypes.c_uint64),
        ]

    seccomp = ctypes.CDLL("libseccomp.so.2", use_errno=True)
    seccomp.seccomp_init.argtypes = [ctypes.c_uint32]
    seccomp.seccomp_init.restype = ctypes.c_void_p
    seccomp.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    seccomp.seccomp_rule_add_array.argtypes = [
        ctypes.c_void_p,
        ctypes.c_uint32,
        ctypes.c_int,
        ctypes.c_uint,
        ctypes.POINTER(Argument),
    ]
    seccomp.seccomp_load.argtypes = [ctypes.c_void_p]
    seccomp.seccomp_release.argtypes = [ctypes.c_void_p]
    context = seccomp.seccomp_init(0x7FFF0000)  # SCMP_ACT_ALLOW
    if not context:
        raise RuntimeError("seccomp unavailable")
    try:
        unix_only = Argument(0, 1, 1, 0)  # arg0 != AF_UNIX: SCMP_CMP_NE
        _checked(
            seccomp.seccomp_rule_add_array(
                context,
                0x00050000 | errno.EPERM,
                seccomp.seccomp_syscall_resolve_name(b"socket"),
                1,
                ctypes.byref(unix_only),
            )
        )
        _checked(seccomp.seccomp_load(context))
    finally:
        seccomp.seccomp_release(context)
    resource.setrlimit(resource.RLIMIT_AS, (2 * 1024**3, 2 * 1024**3))
    resource.setrlimit(resource.RLIMIT_CPU, (30, 30))
    resource.setrlimit(resource.RLIMIT_FSIZE, (64 * 1024**2, 64 * 1024**2))
    resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))


def main(task: Path) -> None:
    # Drop root before parsing any workbook or launching Calc.
    if os.getuid() == 0:
        os.chown(task, 65534, 65534)
        for path in task.iterdir():
            os.chown(path, 65534, 65534)
        os.setgroups([])
        os.setgid(65534)
        os.setuid(65534)
    sandbox(task)
    import uno
    from com.sun.star.beans import PropertyValue

    def prop(name, value):
        item = PropertyValue()
        item.Name, item.Value = name, value
        return item

    executable = "/usr/lib/libreoffice/program/soffice.bin"
    version = subprocess.check_output([executable, "--version"], text=True).strip()
    if not version.startswith("LibreOffice 25.2.3.2 "):
        raise RuntimeError("Unverified Calc version")
    pipe = f"paylite_{uuid4().hex}"
    command = [
        executable,
        "--headless",
        "--nologo",
        "--nodefault",
        "--norestore",
        f"-env:UserInstallation={(task / 'profile').as_uri()}",
        f"--accept=pipe,name={pipe};urp;StarOffice.ComponentContext",
    ]
    process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext(
        "com.sun.star.bridge.UnoUrlResolver", local
    )
    deadline = time.monotonic() + 10
    restarted = False
    while True:
        try:
            remote = resolver.resolve(f"uno:pipe,name={pipe};urp;StarOffice.ComponentContext")
            break
        except Exception:
            # Calc requests one restart after initializing a fresh isolated user profile.
            if process.poll() == 81 and not restarted:
                process = subprocess.Popen(
                    command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
                )
                restarted = True
                continue
            if process.poll() is not None or time.monotonic() > deadline:
                raise RuntimeError("Calc failed to start")
            time.sleep(0.05)
    desktop = remote.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", remote)
    document = desktop.loadComponentFromURL(
        (task / "input.xlsx").as_uri(),
        "_blank",
        0,
        (
            prop("Hidden", True),
            prop(
                "MacroExecutionMode",
                uno.getConstantByName("com.sun.star.document.MacroExecMode.NEVER_EXECUTE"),
            ),
            prop(
                "UpdateDocMode",
                uno.getConstantByName("com.sun.star.document.UpdateDocMode.NO_UPDATE"),
            ),
        ),
    )
    if document is None:
        raise RuntimeError("Workbook load failed")
    try:
        document.calculateAll()
        document.storeAsURL(
            (task / "output.xlsx").as_uri(),
            (
                prop("FilterName", "Calc MS Excel 2007 XML"),
                prop("Overwrite", True),
            ),
        )
    finally:
        document.close(True)
        desktop.terminate()
    (task / "result.json").write_text(json.dumps({"version": version}))


if __name__ == "__main__":
    main(Path(sys.argv[1]).resolve())
