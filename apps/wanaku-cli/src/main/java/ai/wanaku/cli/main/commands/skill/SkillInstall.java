package ai.wanaku.cli.main.commands.skill;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.List;
import org.jline.terminal.Terminal;
import ai.wanaku.cli.main.commands.BaseCommand;
import ai.wanaku.cli.main.support.WanakuPrinter;
import picocli.CommandLine;

/** Installs bundled skills into an agent-specific or explicitly selected directory. */
@CommandLine.Command(
        name = "install",
        description = "Install bundled skills; existing skill directories are not overwritten")
public class SkillInstall extends BaseCommand {
    @CommandLine.Option(names = "--codex", description = "Install to ~/.codex/skills/")
    private boolean codex;

    @CommandLine.Option(names = "--claude", description = "Install to ~/.claude/skills/")
    private boolean claude;

    @CommandLine.Option(names = "--to", description = "Install to this directory (overrides agent flags)")
    private Path destination;

    /**
     * Copies the bundled skills to the selected destination without overwriting existing skills.
     *
     * @param terminal terminal provided by command execution
     * @param printer printer for installation status and error messages
     * @return the success exit code after installation, or the error exit code on failure
     */
    @Override
    public Integer doCall(Terminal terminal, WanakuPrinter printer) {
        if (destination == null && codex == claude) {
            printer.printErrorMessage("Specify --to or exactly one of --codex and --claude");
            return EXIT_ERROR;
        }

        Path target = destination != null
                ? destination
                : Path.of(System.getProperty("user.home"), codex ? ".codex" : ".claude", "skills");
        try {
            ClassLoader loader = Thread.currentThread().getContextClassLoader();
            if (loader == null) {
                loader = SkillInstall.class.getClassLoader();
            }
            List<String> resources;
            // An explicit index works in JARs and native images without filesystem scanning.
            try (InputStream index = openResource(loader, "skills/index.txt");
                    BufferedReader reader = new BufferedReader(new InputStreamReader(index, StandardCharsets.UTF_8))) {
                resources = reader.lines().filter(line -> !line.isBlank()).toList();
            }
            if (resources.isEmpty()) {
                throw new IOException("No bundled skills found");
            }
            // Check every skill before copying so an existing target cannot cause a partial install.
            for (String resource : resources) {
                Path skillDirectory = target.resolve(Path.of(resource).getName(0));
                if (Files.exists(skillDirectory, LinkOption.NOFOLLOW_LINKS)) {
                    printer.printErrorMessage(String.format(
                            "Directory '%s' already exists; choose another --to destination", skillDirectory));
                    return EXIT_ERROR;
                }
                try (InputStream ignored = openResource(loader, "skills/" + resource)) {
                    // Verify that the indexed resources are bundled before creating any files.
                }
            }
            for (String resource : resources) {
                Path file = target.resolve(resource);
                Files.createDirectories(file.getParent());
                try (InputStream input = openResource(loader, "skills/" + resource)) {
                    Files.copy(input, file);
                }
            }
            printer.printSuccessMessage(String.format("Skills installed to '%s'", target));
            return EXIT_OK;
        } catch (IOException e) {
            printer.printErrorMessage(
                    "Failed to install skills: " + e.getMessage()
                            + ". Check the destination path and permissions; if bundled resources are missing, reinstall the CLI.");
            return EXIT_ERROR;
        }
    }

    private InputStream openResource(ClassLoader loader, String resource) throws IOException {
        InputStream input = loader.getResourceAsStream(resource);
        if (input == null) {
            throw new IOException("Bundled skill resource not found: " + resource);
        }
        return input;
    }
}
