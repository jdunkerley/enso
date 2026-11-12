package org.enso.jvm.channel;

import org.graalvm.nativeimage.c.CContext;
import org.graalvm.nativeimage.c.struct.CField;
import org.graalvm.nativeimage.c.struct.CStruct;
import org.graalvm.word.PointerBase;

/** The JNI functions {@link JVM#executeMain} calls. */
@CContext(value = JNIDirectives.class)
@CStruct(value = "JNINativeInterface_", addStructKeyword = true)
interface JNINativeInterface extends PointerBase {

  @CField(value = "NewStringUTF")
  JNI.NewStringUTF8 getNewStringUTF();

  @CField(value = "NewObjectArray")
  JNI.NewObjectArray getNewObjectArray();

  @CField(value = "SetObjectArrayElement")
  JNI.SetObjectArrayElement getSetObjectArrayElement();

  @CField(value = "FindClass")
  JNI.FindClass getFindClass();

  @CField(value = "GetStaticMethodID")
  JNI.GetStaticMethodID getGetStaticMethodID();

  @CField(value = "CallStaticVoidMethodA")
  JNI.CallStaticVoidMethodA getCallStaticVoidMethodA();
}
