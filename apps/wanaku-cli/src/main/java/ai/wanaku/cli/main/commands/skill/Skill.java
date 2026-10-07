package ai.wanaku.cli.main.commands.skill;

import org.jline.terminal.Terminal;
import ai.wanaku.cli.main.commands.BaseCommand;
import ai.wanaku.cli.main.support.WanakuPrinter;
import picocli.CommandLine;

/** Parent command for managing the skills bundled with the CLI. */
@CommandLine.Command(
        name = "skill",
        description = "Manage bundled agent skills",
        subcommands = {SkillInstall.class})
public class Skill extends BaseCommand {
    /**
     * Displays usage when no skill subcommand is selected.
     *
     * @param terminal terminal provided by command execution
     * @param printer printer provided by command execution
     * @return the error exit code because a subcommand is required
     */
    @Override
    public Integer doCall(Terminal terminal, WanakuPrinter printer) {
        CommandLine.usage(this, System.out);
        return EXIT_ERROR;
    }
}
