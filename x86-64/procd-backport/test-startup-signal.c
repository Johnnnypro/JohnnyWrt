/* Disposable VM only: pause the named procd child exactly at ujail exec. */
#define _GNU_SOURCE
#include <sys/ptrace.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include <errno.h>

static int reload_fd;

static void payload_signal(int sig)
{
	if (sig == SIGTERM)
		_exit(0);
	if (write(reload_fd, "reload\n", 7) != 7)
		_exit(2);
}

static void dump_status(pid_t pid)
{
	char path[64], line[256];
	snprintf(path, sizeof(path), "/proc/%d/status", pid);
	FILE *f = fopen(path, "r");
	if (!f)
		return;
	while (fgets(line, sizeof(line), f))
		if (!strncmp(line, "Sig", 3) || !strncmp(line, "ShdPnd:", 7))
			fputs(line, stdout);
	fclose(f);
	fflush(stdout);
}

int main(int argc, char **argv)
{
	if (argc == 3 && !strcmp(argv[1], "payload")) {
		char path[256];
		snprintf(path, sizeof(path), "%s/reloaded", argv[2]);
		reload_fd = open(path, O_WRONLY | O_CREAT | O_APPEND, 0600);
		if (reload_fd < 0)
			return 2;
		signal(SIGHUP, payload_signal);
		signal(SIGTERM, payload_signal);
		snprintf(path, sizeof(path), "%s/started", argv[2]);
		int fd = open(path, O_WRONLY | O_CREAT, 0600);
		if (fd < 0 || write(fd, "started\n", 8) != 8)
			return 2;
		close(fd);
		for (;;)
			pause();
	}
	if (argc != 4) {
		fprintf(stderr, "usage: %s service-name ready-file continue-file\n", argv[0]);
		return 2;
	}
	long opts = PTRACE_O_TRACEFORK | PTRACE_O_TRACEVFORK |
		PTRACE_O_TRACECLONE | PTRACE_O_TRACEEXEC;
	if (ptrace(PTRACE_SEIZE, 1, 0, opts)) {
		perror("seize procd");
		return 2;
	}
	puts("Attached procd");
	fflush(stdout);
	time_t deadline = time(NULL) + 20;
	pid_t held = 0;
	while (time(NULL) < deadline) {
		if (held && !access(argv[3], F_OK)) {
			dump_status(held);
			if (ptrace(PTRACE_CONT, held, 0, 0)) return 2;
			/* No EXITKILL: kernel detaches tracees when this tracer exits. */
			return 0;
		}
		int status;
		pid_t pid = waitpid(-1, &status, __WALL | WNOHANG);
		if (pid == 0) { usleep(10000); continue; }
		if (pid < 0) { if (errno == EINTR) continue; perror("waitpid"); return 2; }
		if (!WIFSTOPPED(status))
			continue;
		unsigned event = (unsigned)status >> 16;
		if (event == PTRACE_EVENT_EXEC) {
			char path[64], exe[256], args[4096];
			snprintf(path, sizeof(path), "/proc/%d/exe", pid);
			ssize_t n = readlink(path, exe, sizeof(exe) - 1);
			if (n >= 0) exe[n] = 0; else exe[0] = 0;
			snprintf(path, sizeof(path), "/proc/%d/cmdline", pid);
			int fd = open(path, O_RDONLY);
			n = fd < 0 ? -1 : read(fd, args, sizeof(args) - 1);
			if (fd >= 0) close(fd);
			int named = 0;
			if (n >= 0) {
				args[n] = 0;
				for (ssize_t i = 0; i < n; ) {
					ssize_t next = i + strlen(args + i) + 1;
					if (!strcmp(args + i, "-n") && next < n && !strcmp(args + next, argv[1]))
						named = 1;
					i = next;
				}
				for (ssize_t i = 0; i < n; i++) if (!args[i]) args[i] = ' ';
			} else args[0] = 0;
			if (!held && !strcmp(exe, "/sbin/ujail") && named) {
				printf("Ujail exec-stop pid=%d args=%s\n", pid, args);
				dump_status(pid);
				FILE *f = fopen(argv[2], "w");
				if (!f) return 2;
				fprintf(f, "%d\n", pid); fclose(f);
				held = pid;
				/* Keep servicing PID1 and other children while this one waits. */
				continue;
			}
		}
		int sig = event ? 0 : WSTOPSIG(status);
		if (ptrace(PTRACE_CONT, pid, 0, sig) && errno != ESRCH) {
			perror("continue"); return 2;
		}
	}
	fputs("ujail exec-stop deadline exceeded\n", stderr);
	return 2;
}
