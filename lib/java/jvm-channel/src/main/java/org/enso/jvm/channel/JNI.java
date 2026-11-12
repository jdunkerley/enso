package org.enso.jvm.channel;

import org.graalvm.nativeimage.c.CContext;
import org.graalvm.nativeimage.c.constant.CConstant;
import org.graalvm.nativeimage.c.function.CFunctionPointer;
import org.graalvm.nativeimage.c.function.InvokeCFunctionPointer;
import org.graalvm.nativeimage.c.struct.CField;
import org.graalvm.nativeimage.c.struct.CPointerTo;
import org.graalvm.nativeimage.c.struct.CStruct;
import org.graalvm.nativeimage.c.type.CCharPointer;
import org.graalvm.word.PointerBase;

/**
 * The part of the JNI invocation API that {@link JVM} uses: start a JVM, attach a thread, and call
 * a static {@code main(String[])}.
 */
@CContext(JNIDirectives.class)
final class JNI {
  @CConstant
  static native int JNI_OK();

  @CConstant
  static native int JNI_VERSION_10();

  interface JMethodID extends PointerBase {}

  interface JObject extends PointerBase {}

  interface JObjectArray extends JObject {}

  interface JClass extends JObject {}

  interface JString extends JObject {}

  @CStruct("jvalue")
  interface JValue extends PointerBase {
    @CField("l")
    JObject getJObject();

    @CField("l")
    void setJObject(JObject obj);
  }

  @CStruct(value = "JNIEnv_", addStructKeyword = true)
  interface JNIEnv extends PointerBase {

    @CField("functions")
    JNINativeInterface getFunctions();
  }

  @CPointerTo(JNIEnv.class)
  interface JNIEnvPointer extends PointerBase {

    JNIEnv readJNIEnv();

    void writeJNIEnv(JNIEnv env);
  }

  @CStruct(value = "JavaVM_", addStructKeyword = true)
  interface JavaVM extends PointerBase {

    @CField("functions")
    JNIInvokeInterface getFunctions();
  }

  @CPointerTo(JavaVM.class)
  interface JavaVMPointer extends PointerBase {

    JavaVM readJavaVM();

    void writeJavaVM(JavaVM javaVM);
  }

  @CStruct(value = "JNIInvokeInterface_", addStructKeyword = true)
  interface JNIInvokeInterface extends PointerBase {

    @CField("AttachCurrentThread")
    AttachCurrentThread getAttachCurrentThread();
  }

  interface CallStaticVoidMethodA extends CFunctionPointer {

    @InvokeCFunctionPointer
    void call(JNIEnv env, JClass clazz, JMethodID methodID, JValue args);
  }

  interface FindClass extends CFunctionPointer {

    @InvokeCFunctionPointer
    JClass call(JNIEnv env, CCharPointer name);
  }

  interface GetStaticMethodID extends CFunctionPointer {

    @InvokeCFunctionPointer
    JMethodID call(JNIEnv env, JClass clazz, CCharPointer name, CCharPointer sig);
  }

  interface NewObjectArray extends CFunctionPointer {

    @InvokeCFunctionPointer
    JObjectArray call(JNIEnv env, int len, JClass clazz, JObject init);
  }

  interface NewStringUTF8 extends CFunctionPointer {

    @InvokeCFunctionPointer
    JString call(JNIEnv env, CCharPointer bytes);
  }

  interface SetObjectArrayElement extends CFunctionPointer {

    @InvokeCFunctionPointer
    void call(JNIEnv env, JObjectArray array, int index, JObject val);
  }

  interface AttachCurrentThread extends CFunctionPointer {

    @InvokeCFunctionPointer
    int call(JavaVM vm, JNIEnvPointer envOut, PointerBase argsOrNull);
  }
}
