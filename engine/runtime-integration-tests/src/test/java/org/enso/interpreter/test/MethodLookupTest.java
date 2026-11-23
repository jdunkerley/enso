package org.enso.interpreter.test;

import static org.junit.Assert.assertEquals;

import java.io.IOException;
import java.util.Set;
import org.enso.pkg.QualifiedName;
import org.enso.test.utils.ProjectUtils;
import org.enso.test.utils.SourceModule;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * `Meta.get_method_annotation`, `Meta.find_type_or_module` and `Meta.call_module_method` find a
 * definition by module, type and name, as the IDE's method pointers name it: exactly that
 * definition, not the one dispatch on a value would pick. `Meta.get_method_argument_names` lists
 * the parameters of the definition found the same way, {@code self} excluded.
 */
public class MethodLookupTest {
  @Rule public TemporaryFolder tempFolder = new TemporaryFolder();

  @Test
  public void findsExactlyTheNamedDefinition() throws IOException {
    var types =
        new SourceModule(
            QualifiedName.fromString("Types"),
            """
            from Standard.Base import all

            type T
                @x ("constructor x")
                Value x

                @a ("instance a")
                inst self a = a

                @a ("static a")
                stat a = a

                @a ("T's probe")
                probe self a = a

                two self a (b = 1) = a + b

            @a ("Any's probe")
            Any.probe self a = a

            @a ("module a")
            module_method a = a

            sum3 a b c = a + b + c

            sum_defaults a b=10 c=100 = a + b + c

            is_error_value value = value.is_error
            """);
    // Not imported by Main: the lookup compiles a registered module itself.
    var ext =
        new SourceModule(
            QualifiedName.fromString("Ext"),
            """
            from Standard.Base import all
            from project.Types import T

            @a ("extension a")
            T.ext self a = a
            """);
    var main =
        new SourceModule(
            QualifiedName.fromString("Main"),
            """
            from Standard.Base import all
            import project.Types

            show r = if r.is_error then "error:" + (Meta.type_of r.catch . to_text) else r.to_text

            main =
                t = "local.Proj.Types.T"
                m = "local.Proj.Types"
                results = Vector.build b->
                    b.append (show (Meta.get_method_annotation m t "inst" "a"))
                    b.append (show (Meta.get_method_annotation m t "stat" "a"))
                    b.append (show (Meta.get_method_annotation m t "Value" "x"))
                    b.append (show (Meta.get_method_annotation "local.Proj.Ext" t "ext" "a"))
                    b.append (show (Meta.get_method_annotation m m "module_method" "a"))
                    b.append (show (Meta.get_method_annotation m "Standard.Base.Any.Any" "probe" "a"))
                    b.append (show (Meta.get_method_annotation m t "probe" "a"))
                    b.append (show (Meta.get_method_annotation m t "inst" "zzz"))
                    b.append (show (Meta.get_method_annotation m t "missing" "a"))
                    b.append (show (Meta.get_method_annotation "local.Proj.Nope" "local.Proj.Nope" "f" "a"))
                    b.append (show (Meta.find_type_or_module t . to_text))
                    b.append (show (Meta.call_module_method m "sum3" [2, 2] 1))
                    b.append (show (Meta.call_module_method m "sum_defaults" [2, 3] 1))
                    b.append (show (Meta.call_module_method m "sum_defaults" [2] 1))
                    b.append (show (Meta.call_module_method m "sum_defaults" [] 1))
                    b.append (show (Meta.call_module_method m "is_error_value" [] (Error.throw "e")))
                    b.append (show (Meta.get_method_argument_names m t "two"))
                    b.append (show (Meta.get_method_argument_names m t "stat"))
                    b.append (show (Meta.get_method_argument_names "local.Proj.Ext" t "ext"))
                    b.append (show (Meta.get_method_argument_names m m "sum_defaults"))
                    b.append (show (Meta.get_method_argument_names m t "Value"))
                    b.append (show (Meta.get_method_argument_names m t "nope"))
                results.join "|"
            """);
    var projDir = tempFolder.newFolder().toPath();
    ProjectUtils.createProject("Proj", Set.of(types, ext, main), projDir);
    ProjectUtils.testProjectRun(
        projDir,
        res ->
            assertEquals(
                "instance a|static a|constructor x|extension a|module a|Any's probe|T's probe"
                    + "|Nothing|error:No_Such_Method|error:Module_Does_Not_Exist|T|5|6|103|111|True"
                    + "|[a, b]|[a]|[a]|[a, b, c]|[x]|error:No_Such_Method",
                res.asString()));
  }
}
