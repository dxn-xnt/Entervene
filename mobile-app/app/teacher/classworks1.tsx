// import React, { useState } from "react";
// import { router } from "expo-router";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   ScrollView,
// } from "react-native";
// import { SafeAreaView } from "react-native-safe-area-context";
// import { Ionicons } from "@expo/vector-icons";

// import { useDrawer } from "@/context/DrawerContext";
// import { AppColors, Spacing, Borders, NeoShadow } from "@/constants/theme";
// import TabBar from "@/components/TabBar";
// import ClassworkCard from "@/components/classwork-card";

// const todoTabs = [
//   { id: "all", label: "All" },
//   { id: "readings", label: "Readings" },
//   { id: "activities", label: "Activities" },
//   { id: "assignments", label: "Assignments" },
//   { id: "quizzes", label: "Quizzes" },
// ];

// export default function TeacherClassworks() {
//   const { openDrawer } = useDrawer();
//   const [activeTab, setActiveTab] = useState("all");

//   return (
//     <SafeAreaView style={styles.safe} edges={["top"]}>
//       <ScrollView contentContainerStyle={styles.contentContainer}>
//         <View style={styles.header}>
//           <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
//             <TouchableOpacity onPress={openDrawer} activeOpacity={0.7}>
//               <Ionicons name="menu" size={24} color={AppColors.foreground} />
//             </TouchableOpacity>
//             <Text style={styles.title}>Classworks</Text>
//           </View>
//           <TouchableOpacity
//             onPress={() => router.push("/teacher/Create_Classwork_Forms/new-classwork-form")}
//           >
//             <Text style={styles.newClassworkButton}>+ New Classwork</Text>
//           </TouchableOpacity>
//         </View>

//         <TabBar tabs={todoTabs} activeTab={activeTab} onChange={setActiveTab} />

//         <View style={styles.body}>
//           <ClassworkCard
//             title="Coding Activity"
//             createdAt="Created October 30, 2025"
//             badges={[{ label: "Badge 1" }, { label: "Badge 2" }]}
//           />
//         </View>
//       </ScrollView>
//     </SafeAreaView>
//   );
// }

// const styles = StyleSheet.create({
//   safe: {
//     flex: 1,
//     backgroundColor: AppColors.background,
//   },
//   contentContainer: {
//     paddingBottom: 32,
//   },
//   header: {
//     flexDirection: "row",
//     alignItems: "center",
//     justifyContent: "space-between",
//     gap: 12,
//     paddingHorizontal: Spacing.lg,
//     paddingVertical: 14,
//     borderBottomWidth: Borders.width,
//     borderBottomColor: AppColors.border,
//   },
//   title: {
//     fontSize: 18,
//     fontWeight: "700",
//     color: AppColors.foreground,
//   },
//   newClassworkButton: {
//     paddingVertical: 6,
//     paddingHorizontal: 12,
//     backgroundColor: "#7ABA78",
//     borderWidth: 1,
//     borderRadius: 8,
//     shadowColor: AppColors.black,
//     ...NeoShadow.lg,
//   },
//   body: {
//     flex: 1,
//     padding: 16,
//     gap: 20,
//   },
// });